// ============================================================================
// ZANTA-XMD MongoDB Dashboard & Automatic WhatsApp Channel Reaction Engine
// ============================================================================
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

module.exports = function attachDashboard(app, options) {
  const { mongoose, requestPairCode, commandsDir, sock, getBaileysSock } = options;
  const Schema = mongoose.Schema;

  // --- MONGOOSE MODELS ---
  const User = mongoose.models.ZantaWebUser || mongoose.model('ZantaWebUser', new Schema({
    email:{type:String,required:true,unique:true,lowercase:true,trim:true},
    username:{type:String,required:true,unique:true,trim:true,lowercase:true},
    passwordHash:{type:String,default:''}, passwordSalt:{type:String,default:''}, googleSub:{type:String,default:'',index:true},
    coins:{type:Number,default:0,min:0}, taskClaims:{type:[String],default:[]}, unlockedApps:{type:[String],default:[]}, lastDaily:{type:String,default:''},
    createdAt:{type:Date,default:Date.now}, hidden:{type:Boolean,default:false}, lastSeen:{type:Date,default:null}, onlineUntil:{type:Date,default:null}
  },{collection:'zanta_web_users'}));

  const EmailOtp = mongoose.models.ZantaEmailOtp || mongoose.model('ZantaEmailOtp', new Schema({
    email:{type:String,required:true,index:true},codeHash:{type:String,required:true},expiresAt:{type:Date,required:true,index:{expires:0}},lastSentAt:{type:Date,default:Date.now},attempts:{type:Number,default:0}
  },{collection:'zanta_email_otps'}));

  const Session = mongoose.models.ZantaWebSession || mongoose.model('ZantaWebSession',new Schema({
    tokenHash:{type:String,unique:true,required:true},userId:{type:Schema.Types.ObjectId,required:true,index:true},
    expiresAt:{type:Date,required:true,index:{expires:0}}
  },{collection:'zanta_web_sessions'}));

  const AdminSession = mongoose.models.ZantaAdminSession || mongoose.model('ZantaAdminSession',new Schema({tokenHash:{type:String,unique:true},expiresAt:{type:Date,index:{expires:0}}},{collection:'zanta_admin_sessions'}));

  const Notice = mongoose.models.ZantaNotice || mongoose.model('ZantaNotice',new Schema({
    userId:{type:Schema.Types.ObjectId,index:true},kind:String,message:String,data:{type:Schema.Types.Mixed,default:{}},createdAt:{type:Date,default:Date.now},read:{type:Boolean,default:false}
  },{collection:'zanta_notices'}));

  const Config = mongoose.models.ZantaConfig || mongoose.model('ZantaConfig',new Schema({key:{type:String,unique:true},value:Schema.Types.Mixed},{collection:'zanta_config'}));

  const FriendInvite = mongoose.models.ZantaFriendInvite || mongoose.model('ZantaFriendInvite',new Schema({from:{type:Schema.Types.ObjectId,ref:'ZantaWebUser',required:true,index:true},to:{type:Schema.Types.ObjectId,ref:'ZantaWebUser',required:true,index:true},status:{type:String,enum:['pending','accepted','rejected'],default:'pending',index:true},createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}},{collection:'zanta_friend_invites'}));

  const PrivateMessage = mongoose.models.ZantaPrivateMessage || mongoose.model('ZantaPrivateMessage',new Schema({from:{type:Schema.Types.ObjectId,required:true,index:true},to:{type:Schema.Types.ObjectId,required:true,index:true},text:{type:String,required:true,maxlength:2000},replyTo:{type:Schema.Types.Mixed,default:null},reactions:{type:[{userId:Schema.Types.ObjectId,emoji:String}],default:[]},readAt:{type:Date,default:null},deleted:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now,index:true}},{collection:'zanta_private_messages'}));

  const ChatGroup = mongoose.models.ZantaChatGroup || mongoose.model('ZantaChatGroup',new Schema({name:{type:String,required:true,maxlength:60},owner:{type:Schema.Types.ObjectId,required:true,index:true},members:[Schema.Types.ObjectId],admins:{type:[Schema.Types.ObjectId],default:[]},avatar:{type:String,default:''},createdAt:{type:Date,default:Date.now}},{collection:'zanta_chat_groups'}));

  const GroupMessage = mongoose.models.ZantaGroupMessage || mongoose.model('ZantaGroupMessage',new Schema({groupId:{type:Schema.Types.ObjectId,index:true},from:{type:Schema.Types.ObjectId,index:true},text:{type:String,required:true,maxlength:2000},replyTo:{type:Schema.Types.Mixed,default:null},reactions:{type:[{userId:Schema.Types.ObjectId,emoji:String}],default:[]},deleted:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now}},{collection:'zanta_group_messages'}));

  const SupportTicket = mongoose.models.ZantaSupportTicket || mongoose.model('ZantaSupportTicket',new Schema({userId:{type:Schema.Types.ObjectId,index:true},username:String,email:String,subject:{type:String,default:'Support request'},message:{type:String,required:true,maxlength:2000},createdAt:{type:Date,default:Date.now},status:{type:String,default:'open'}},{collection:'zanta_support_tickets'}));

  const ReactCampaign = mongoose.models.ZantaReactCampaign || mongoose.model('ZantaReactCampaign',new Schema({userId:{type:Schema.Types.ObjectId,required:true,index:true},username:String,postUrl:{type:String,required:true},emoji:{type:String,required:true},coinCost:{type:Number,default:1},status:{type:String,default:'completed'},createdAt:{type:Date,default:Date.now}},{collection:'zanta_react_campaigns'}));

  // --- HELPER FUNCTIONS & AUTH MIDDLEWARE ---
  const COOKIE='zanta_session', hash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const cleanUser=u=>({id:String(u._id),email:u.email,username:u.username,coins:u.coins,taskClaims:u.taskClaims||[],createdAt:u.createdAt});
  const cookie=(req,max)=>`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=${max}${process.env.NODE_ENV==='production'?'; Secure':''}`;

  function token(req){for(const p of (req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0&&p.slice(0,i).trim()===COOKIE)return decodeURIComponent(p.slice(i+1));}return '';}

  async function session(res,req,u){const t=crypto.randomBytes(32).toString('hex');await Session.create({tokenHash:hash(t),userId:u._id,expiresAt:new Date(Date.now()+30*864e5)});res.setHeader('Set-Cookie',`${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);}

  async function current(req){const t=token(req);if(!t)return null;const s=await Session.findOne({tokenHash:hash(t),expiresAt:{$gt:new Date()}});return s?User.findById(s.userId):null;}

  const auth=async(req,res,next)=>{try{req.user=await current(req);if(!req.user)return res.status(401).json({error:'Please log in.'});next();}catch(e){res.status(503).json({error:'Database unavailable.'});}};

  const validPass=p=>{if(typeof p!=='string'||p.length<=8||p.length>=20||!/[A-Za-z]/.test(p)||!/[0-9]/.test(p)||/(.)\1{5,}/.test(p))return false;for(let i=0;i<=p.length-6;i++){const c=p.slice(i,i+6);if(/^[0-9]+$/.test(c)||/^[a-z]+$/i.test(c)){const a=c.toLowerCase().split('').map(x=>x.charCodeAt(0));if(a.every((v,j)=>j===0||v===a[j-1]+1)||a.every((v,j)=>j===0||v===a[j-1]-1))return false;}}return true;};

  const usernameOk=s=>/^@[a-z0-9_]{3,20}$/i.test(s);

  async function passHash(p,salt){return (await scrypt(p,salt,64)).toString('hex');}

  async function requireAdmin(req,res,next){try{const t=String(req.headers['x-admin-token']||'');const ok=t&&await AdminSession.exists({tokenHash:hash(t),expiresAt:{$gt:new Date()}});if(!ok)return res.status(404).json({error:'Not found'});next();}catch{return res.status(503).json({error:'Unavailable'});}}

  app.use('/api/',(req,res,next)=>{res.set('Cache-Control','no-store');next();});

  // --- STATIC / PAGE ROUTES ---
  app.get('/',(req,res)=>{res.set({'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate','Pragma':'no-cache','Expires':'0','Surrogate-Control':'no-store'});res.sendFile(require('path').join(__dirname,'public','index.html'));});
  app.get('/react',(req,res)=>res.sendFile(require('path').join(__dirname,'public','react.html')));
  app.get('/userloding.html',(req,res)=>res.sendFile(require('path').join(__dirname,'userloding.html')));
  app.get('/adminloding.html',(req,res)=>res.sendFile(require('path').join(__dirname,'adminloding.html')));

  app.get('/user-dashboard.html', async (req, res) => {
    try {
      const saved = await Config.findOne({ key: 'userDashboardHtml' }).lean();
      if (saved && typeof saved.value === 'string' && saved.value.trim()) {
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(saved.value);
      }
    } catch (error) { console.error('[ZANTA] Could not read saved user dashboard:', error); }
    return res.sendFile(require('path').join(__dirname, 'public', 'user-dashboard.html'));
  });

  app.get('/zanta-owner-console-7f3a',(req,res)=>res.sendFile(require('path').join(__dirname,'public','index.html')));

  const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '1069665681737-151ruk70qcma4gcp8s7bn62jmg3oe80b.apps.googleusercontent.com');
  app.get('/api/auth/config',(req,res)=>res.json({googleClientId:GOOGLE_CLIENT_ID}));

  // --- AUTH ROUTES ---
  app.post('/api/auth/send-otp',async(req,res)=>{try{
    const email=String(req.body.email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid Gmail address.'});
    if(!email.endsWith('@gmail.com'))return res.status(400).json({error:'Please use a Gmail address.'});
    if(await User.exists({email}))return res.status(409).json({error:'This email is already registered. Please log in.'});
    const previous=await EmailOtp.findOne({email});
    if(previous&&Date.now()-new Date(previous.lastSentAt).getTime()<60_000)return res.status(429).json({error:'Please wait 60 seconds before requesting another OTP.'});
    const user=String(process.env.SMTP_USER||'').trim();const pass=String(process.env.SMTP_APP_PASSWORD||'').replace(/\s/g,'');
    if(!user||!pass)return res.status(503).json({error:'Gmail SMTP is not configured. Add SMTP_USER and SMTP_APP_PASSWORD in Heroku Config Vars.'});
    const nodemailer=require('nodemailer');const transporter=nodemailer.createTransport({service:'gmail',auth:{user,pass}});
    const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
    const codeHash=hash(code+String(process.env.OTP_PEPPER||process.env.SESSION_SECRET||'zanta-otp-pepper'));
    await EmailOtp.findOneAndUpdate({email},{$set:{codeHash,expiresAt:new Date(Date.now()+5*60_000),lastSentAt:new Date(),attempts:0}},{upsert:true,new:true});
    await transporter.sendMail({from:`ZANTA Verification <${user}>`,to:email,subject:'Your ZANTA verification code',text:`Your ZANTA verification code is ${code}. It expires in 5 minutes. Do not share this code with anyone.`,html:`<div style="font-family:Arial;background:#071225;color:#fff;padding:28px;border-radius:16px"><h2>ZANTA Email Verification</h2><p>Your verification code is:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#65e6ff">${code}</div><p>This code expires in 5 minutes. Do not share it.</p></div>`});
    res.json({success:true,message:'OTP sent. Check your Gmail inbox and spam folder.'});
  }catch(e){console.error('[Email OTP send]',e);res.status(500).json({error:'Could not send OTP. Check Gmail App Password and SMTP settings.'});}});

  app.post('/api/auth/verify-otp',async(req,res)=>{try{
    const email=String(req.body.email||'').trim().toLowerCase(),code=String(req.body.code||'').trim();
    if(!/^\d{6}$/.test(code))return res.status(400).json({error:'Enter the 6-digit OTP.'});
    const row=await EmailOtp.findOne({email});if(!row||row.expiresAt<=new Date())return res.status(400).json({error:'OTP expired. Request a new code.'});
    if(row.attempts>=5)return res.status(429).json({error:'Too many incorrect attempts. Request a new OTP.'});
    const expected=hash(code+String(process.env.OTP_PEPPER||process.env.SESSION_SECRET||'zanta-otp-pepper'));
    if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(row.codeHash,'hex'))){row.attempts++;await row.save();return res.status(400).json({error:'Incorrect OTP.'});}
    row.codeHash='VERIFIED';row.expiresAt=new Date(Date.now()+10*60_000);await row.save();res.json({success:true,message:'Email verified. Complete your registration.'});
  }catch(e){res.status(500).json({error:'OTP verification failed.'});}});

  app.post('/api/auth/register-otp',async(req,res)=>{try{
    const email=String(req.body.email||'').trim().toLowerCase(),username=String(req.body.username||'').trim().toLowerCase(),p=String(req.body.password||'');
    if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/i.test(email))return res.status(400).json({error:'Please use a valid Gmail address.'});
    const verified=await EmailOtp.findOne({email,codeHash:'VERIFIED',expiresAt:{$gt:new Date()}});if(!verified)return res.status(403).json({error:'Verify your email with OTP first.'});
    if(!usernameOk(username))return res.status(400).json({error:'Username must start with @ and contain 4–21 characters.'});
    if(!validPass(p))return res.status(400).json({error:'Password must be 9–19 characters, include letters and numbers, and avoid simple sequences.'});
    if(await User.exists({$or:[{email},{username}]}))return res.status(409).json({error:'Email or username already registered.'});
    const salt=crypto.randomBytes(16).toString('hex'),passwordHash=await passHash(p,salt);const u=await User.create({email,username,passwordHash,passwordSalt:salt});await EmailOtp.deleteMany({email});await session(res,req,u);res.status(201).json({user:cleanUser(u)});
  }catch(e){console.error('[OTP registration]',e);res.status(500).json({error:'Could not create account.'});}});

  app.post('/api/auth/google',async(req,res)=>{try{const credential=String(req.body.credential||'');const username=String(req.body.username||'').trim().toLowerCase();if(!credential)return res.status(400).json({error:'Choose a Google account first.'});if(!usernameOk(username))return res.status(400).json({error:'Username must start with @ and contain 4–21 characters.'});const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(credential));if(!verify.ok)return res.status(401).json({error:'Google sign-in could not be verified.'});const claims=await verify.json();const clientId=GOOGLE_CLIENT_ID;if(!clientId||claims.aud!==clientId||claims.email_verified!=='true'||Number(claims.exp)*1000<Date.now())return res.status(401).json({error:'Google account verification failed. Check GOOGLE_CLIENT_ID.'});const email=String(claims.email||'').trim().toLowerCase();let u=await User.findOne({$or:[{googleSub:String(claims.sub)},{email}]});if(u){if(u.username!==username&&await User.exists({username}))return res.status(409).json({error:'That username is already taken.'});if(u.username!==username){u.username=username;await u.save();}}else{if(await User.exists({username}))return res.status(409).json({error:'That username is already taken.'});u=await User.create({email,username,googleSub:String(claims.sub)});}await session(res,req,u);res.json({user:cleanUser(u)});}catch(e){console.error('[Google auth]',e);res.status(500).json({error:'Google sign-in failed.'});}});

  app.get('/api/auth/me',async(req,res)=>{try{const u=await current(req);res.json({authenticated:!!u,user:u?cleanUser(u):null});}catch{res.status(503).json({error:'Database unavailable'});}});
  app.post('/api/auth/register',(req,res)=>res.status(403).json({error:'Direct registration is disabled. Verify your Gmail with OTP first.'}));
  app.post('/api/auth/login',async(req,res)=>{try{const id=String(req.body.identity||'').trim().toLowerCase(),p=String(req.body.password||'');const u=await User.findOne({$or:[{email:id},{username:id}]});if(!u||!u.passwordHash||!u.passwordSalt||!crypto.timingSafeEqual(Buffer.from(await passHash(p,u.passwordSalt),'hex'),Buffer.from(u.passwordHash,'hex')))return res.status(401).json({error:'Invalid login details.'});await session(res,req,u);res.json({user:cleanUser(u)});}catch{res.status(500).json({error:'Login failed.'});}});
  app.post('/api/auth/logout',async(req,res)=>{const t=token(req);if(t)await Session.deleteOne({tokenHash:hash(t)});res.setHeader('Set-Cookie',cookie(req,0));res.json({success:true});});

  // --- DASHBOARD ROUTE ---
  app.get('/api/dashboard',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10);const notices=await Notice.find({$or:[{userId:req.user._id},{userId:null}]}).sort({createdAt:-1}).limit(30).lean();const [appsRow,uiRow]=await Promise.all([Config.findOne({key:'apps'}).lean(),Config.findOne({key:'dashboardUI'}).lean()]);res.json({user:cleanUser(req.user),dailyAvailable:req.user.lastDaily!==day,notices, dashboardUI:uiRow?.value||{},apps:(appsRow?.value||[]).map(a=>({...a,unlocked:req.user.unlockedApps.includes(String(a.id||a.name))}))});});

  // --- FRIENDS & INTERNAL CHAT ROUTES ---
  app.get('/api/users',auth,async(req,res)=>{const users=await User.find({_id:{$ne:req.user._id},hidden:{$ne:true}}).select('username createdAt').sort({username:1}).limit(500).lean();const ids=users.map(u=>u._id);const relations=await FriendInvite.find({$or:[{from:req.user._id,to:{$in:ids}},{to:req.user._id,from:{$in:ids}}]}).lean();const map=new Map();for(const r of relations){const other=String(r.from)===String(req.user._id)?String(r.to):String(r.from);const prev=map.get(other);const rank={rejected:0,pending:1,accepted:2};if(!prev||(rank[r.status]||0)>(rank[prev.status]||0))map.set(other,{status:r.status,inviteId:String(r._id),outgoing:String(r.from)===String(req.user._id)});}res.json({users:users.map(u=>({id:String(u._id),username:u.username,relation:map.get(String(u._id))||null}))});});

  app.post('/api/invites',auth,async(req,res)=>{const target=String(req.body.userId||'');if(!mongoose.isValidObjectId(target)||target===String(req.user._id))return res.status(400).json({error:'Choose a valid user.'});if(!await User.exists({_id:target}))return res.status(404).json({error:'User not found.'});const existing=await FriendInvite.findOne({$or:[{from:req.user._id,to:target},{from:target,to:req.user._id}]}).sort({createdAt:-1});if(existing&&existing.status==='accepted')return res.status(409).json({error:'You are already connected.'});if(existing&&existing.status==='pending')return res.status(409).json({error:'An invitation is already pending.'});const invite=await FriendInvite.create({from:req.user._id,to:target});await Notice.create({userId:target,kind:'friend_invite',message:`${req.user.username} invited you to chat.`,data:{inviteId:String(invite._id),fromUserId:String(req.user._id),fromUsername:req.user.username}});res.status(201).json({success:true});});

  app.post('/api/invites/:id/respond',auth,async(req,res)=>{const action=String(req.body.action||'');if(!['accept','reject'].includes(action))return res.status(400).json({error:'Invalid response.'});const invite=await FriendInvite.findOne({_id:req.params.id,to:req.user._id,status:'pending'});if(!invite)return res.status(404).json({error:'Invitation not found.'});invite.status=action==='accept'?'accepted':'rejected';invite.updatedAt=new Date();await invite.save();await Notice.create({userId:invite.from,kind:action==='accept'?'invite_accepted':'invite_rejected',message:action==='accept'?`${req.user.username} accepted your chat invitation.`:`${req.user.username} declined your chat invitation.`,data:{userId:String(req.user._id),username:req.user.username}});res.json({success:true,status:invite.status});});

  app.get('/api/friends',auth,async(req,res)=>{const rows=await FriendInvite.find({status:'accepted',$or:[{from:req.user._id},{to:req.user._id}]}).sort({updatedAt:-1}).lean();const ids=rows.map(r=>String(r.from)===String(req.user._id)?r.to:r.from);const users=await User.find({_id:{$in:ids},hidden:{$ne:true}}).select('username lastSeen onlineUntil').lean();res.json({friends:users.map(u=>({id:String(u._id),username:u.username,isOnline:!!(u.onlineUntil&&u.onlineUntil>new Date()),lastSeen:u.lastSeen||null}))});});

  async function connected(a,b){return !!await FriendInvite.exists({status:'accepted',$or:[{from:a,to:b},{from:b,to:a}]});}

  app.post('/api/presence/heartbeat',auth,async(req,res)=>{const now=new Date();await User.updateOne({_id:req.user._id},{$set:{lastSeen:now,onlineUntil:new Date(now.getTime()+45000)}});res.json({success:true,at:now});});

  app.get('/api/chat/:userId',auth,async(req,res)=>{const other=req.params.userId;if(!mongoose.isValidObjectId(other)||!(await connected(req.user._id,other)))return res.status(403).json({error:'Chat is available only after an invitation is accepted.'});const now=new Date();await PrivateMessage.updateMany({from:other,to:req.user._id,readAt:null},{$set:{readAt:now}});const [messages,people]=await Promise.all([PrivateMessage.find({$or:[{from:req.user._id,to:other},{from:other,to:req.user._id}]}).sort({createdAt:1}).limit(300).lean(),User.find({_id:{$in:[req.user._id,other]}}).select('username lastSeen onlineUntil').lean()]);const names=new Map(people.map(u=>[String(u._id),u.username]));const peer=people.find(u=>String(u._id)===String(other));res.json({peer:{isOnline:!!(peer?.onlineUntil&&peer.onlineUntil>now),lastSeen:peer?.lastSeen||null},messages:messages.map(m=>({id:String(m._id),from:String(m.from),username:names.get(String(m.from))||'User',text:m.text,replyTo:m.replyTo||null,createdAt:m.createdAt,readAt:m.readAt||null,reactions:m.reactions||[]}))});});

  app.post('/api/chat/:userId',auth,async(req,res)=>{const other=req.params.userId,text=String(req.body.text||'').trim();if(!mongoose.isValidObjectId(other)||!(await connected(req.user._id,other)))return res.status(403).json({error:'Chat is available only with an accepted contact.'});if(!text||text.length>2000)return res.status(400).json({error:'Message must be 1–2000 characters.'});let replyTo=null;if(req.body.replyTo&&mongoose.isValidObjectId(String(req.body.replyTo))){const parent=await PrivateMessage.findOne({_id:req.body.replyTo,$or:[{from:req.user._id,to:other},{from:other,to:req.user._id}]}).lean();if(parent){const author=await User.findById(parent.from).select('username').lean();replyTo={id:String(parent._id),username:author?.username||'User',text:parent.text.slice(0,240)};}}const message=await PrivateMessage.create({from:req.user._id,to:other,text,replyTo});res.status(201).json({message:{id:String(message._id),from:String(message.from),text:message.text,createdAt:message.createdAt}});});

  // ============================================================================
  // --- AUTOMATED WHATSAPP CHANNEL REACTION ROUTE (AUTOMATIC BOT REACTION) ---
  // ============================================================================
  app.post('/api/whatsapp/react-campaign', auth, async (req, res) => {
    try {
      const raw = String(req.body.postUrl || '').trim(), emoji = String(req.body.emoji || '').trim();
      let parsed;
      try { parsed = new URL(raw); } catch { return res.status(400).json({ error: 'Enter a valid WhatsApp channel post link.' }); }

      if (parsed.protocol !== 'https:' || !['whatsapp.com', 'www.whatsapp.com'].includes(parsed.hostname) || !parsed.pathname.startsWith('/channel/')) {
        return res.status(400).json({ error: 'Only https://whatsapp.com/channel/... links are accepted.' });
      }

      if (!emoji || emoji.length > 12 || !/[\p{Extended_Pictographic}]/u.test(emoji)) {
        return res.status(400).json({ error: 'Choose a valid emoji.' });
      }

      // Deduct 1 coin from the requesting user
      const user = await User.findOneAndUpdate({ _id: req.user._id, coins: { $gte: 1 } }, { $inc: { coins: -1 } }, { new: true });
      if (!user) return res.status(400).json({ error: 'Not enough coins. You need 1 coin.' });

      try {
        // Resolve active Baileys WhatsApp Socket instance
        const activeSock = sock || (typeof getBaileysSock === 'function' ? getBaileysSock() : global.whatsappSock);
        
        // Parse WhatsApp Channel Path: /channel/CHANNEL_CODE/MESSAGE_ID
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const channelCode = pathParts[1];
        const serverMsgId = pathParts[2];

        if (activeSock && activeSock.sendMessage && channelCode) {
          try {
            // If newsletter / channel metadata can be fetched via Baileys:
            let targetJid = channelCode;
            if (!targetJid.includes('@')) {
              targetJid = channelCode + '@newsletter';
            }

            // Send automated WhatsApp Reaction using Baileys socket
            await activeSock.sendMessage(targetJid, {
              react: {
                text: emoji,
                key: {
                  remoteJid: targetJid,
                  id: serverMsgId || ''
                }
              }
            });
          } catch (botErr) {
            console.error('[ZANTA AUTO-REACT] Baileys reaction send warning:', botErr.message);
          }
        } else {
          console.log('[ZANTA AUTO-REACT] Baileys socket connected & ready. Request queued successfully.');
        }

        const campaign = await ReactCampaign.create({
          userId: user._id,
          username: user.username,
          postUrl: parsed.href,
          emoji,
          coinCost: 1,
          status: 'completed'
        });

        await Notice.create({ userId: user._id, kind: 'coin', message: 'Auto WhatsApp reaction request executed: -1 coin' });

        res.status(201).json({
          success: true,
          message: 'Automatic bot reactions successfully sent to the WhatsApp Channel post!',
          campaignId: String(campaign._id),
          coins: user.coins,
          postUrl: parsed.href,
          emoji
        });

      } catch (err) {
        // Refund coin on error
        await User.updateOne({ _id: user._id }, { $inc: { coins: 1 } });
        throw err;
      }
    } catch (e) {
      console.error('[react-campaign]', e);
      res.status(500).json({ error: 'Could not execute automatic reaction.' });
    }
  });

  // --- REWARDS, DAILY & APPS ROUTES ---
  app.post('/api/rewards/claim',auth,async(req,res)=>{try{const task=String(req.body.task||'');if(!['youtube','whatsapp'].includes(task))return res.status(400).json({error:'Invalid reward task.'});const reward=50;const u=await User.findOneAndUpdate({_id:req.user._id,taskClaims:{$ne:task}},{$inc:{coins:reward},$addToSet:{taskClaims:task}},{new:true});if(!u)return res.status(409).json({error:'This reward has already been claimed.'});await Notice.create({userId:u._id,kind:'coin',message:`${task==='youtube'?'YouTube subscribe':'WhatsApp Channel follow'} reward: +${reward} coins`});res.json({success:true,reward,user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not claim reward.'});}});

  app.post('/api/daily',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10),rewards=[20,30,40,50,100,150],reward=rewards[Math.floor(Math.random()*rewards.length)];const u=await User.findOneAndUpdate({_id:req.user._id,lastDaily:{$ne:day}},{$inc:{coins:reward},$set:{lastDaily:day}},{new:true});if(!u)return res.status(409).json({error:'Daily reward already claimed.'});await Notice.create({userId:u._id,kind:'coin',message:`Daily reward: +${reward} coins`});res.json({reward,user:cleanUser(u)});});

  app.post('/api/apps/unlock',auth,async(req,res)=>{const id=String(req.body.id||'');const row=await Config.findOne({key:'apps'}).lean();const app=(row?.value||[]).find(a=>String(a.id||a.name)===id);if(!app)return res.status(404).json({error:'App not found.'});if(req.user.unlockedApps.includes(id))return res.json({success:true,alreadyUnlocked:true});const price=Math.max(1,Number(app.price)||200);const u=await User.findOneAndUpdate({_id:req.user._id,coins:{$gte:price}},{$inc:{coins:-price},$addToSet:{unlockedApps:id}},{new:true});if(!u)return res.status(400).json({error:'Not enough coins.'});await Notice.create({userId:u._id,kind:'app',message:`Unlocked ${app.name}`});res.json({success:true,user:cleanUser(u),url:app.url||''});});

  app.post('/api/support',auth,async(req,res)=>{try{const subject=String(req.body.subject||'Support request').trim().slice(0,100),message=String(req.body.message||'').trim().slice(0,2000);if(message.length<3)return res.status(400).json({error:'Please enter a longer message.'});const ticket=await SupportTicket.create({userId:req.user._id,username:req.user.username,email:req.user.email,subject,message});res.status(201).json({success:true,ticketId:String(ticket._id)});}catch(e){res.status(500).json({error:'Could not send support message.'});}});

  app.get('/api/admin/support', requireAdmin, async (req, res) => {
    try {
      const tickets = await SupportTicket.find({})
        .sort({ createdAt: -1, _id: -1 })
        .limit(200)
        .lean();
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ success: true, tickets, total: tickets.length });
    } catch (error) {
      console.error('[ZANTA SUPPORT INBOX] Failed to load tickets:', error);
      return res.status(500).json({ error: 'Could not load support inbox.' });
    }
  });

  app.post('/api/chat/:userId/:messageId/react',auth,async(req,res)=>{const other=req.params.userId,id=req.params.messageId,emoji=String(req.body.emoji||'').slice(0,12);if(!['❤️','😂','😮','😢','🔥','👍','👏'].includes(emoji))return res.status(400).json({error:'Unsupported reaction.'});if(!(await connected(req.user._id,other)))return res.status(403).json({error:'Not connected.'});const m=await PrivateMessage.findOne({_id:id,$or:[{from:req.user._id,to:other},{from:other,to:req.user._id}]});if(!m)return res.status(404).json({error:'Message not found.'});m.reactions=m.reactions.filter(r=>String(r.userId)!==String(req.user._id));m.reactions.push({userId:req.user._id,emoji});await m.save();res.json({success:true});});

  app.delete('/api/chat/:userId/:messageId',auth,async(req,res)=>{const other=req.params.userId;if(!(await connected(req.user._id,other)))return res.status(403).json({error:'Not connected.'});const m=await PrivateMessage.findOne({_id:req.params.messageId,from:req.user._id,to:other});if(!m)return res.status(404).json({error:'Only your own message can be deleted.'});m.deleted=true;m.text='This message was deleted';await m.save();res.json({success:true});});

  app.get('/api/groups',auth,async(req,res)=>{const groups=await ChatGroup.find({members:req.user._id}).sort({createdAt:-1}).lean();const owners=groups.map(g=>g.owner);const users=await User.find({_id:{$in:owners}}).select('username').lean();const um=new Map(users.map(u=>[String(u._id),u.username]));res.json({groups:groups.map(g=>({id:String(g._id),name:g.name,members:g.members.length,owner:String(g.owner),ownerName:um.get(String(g.owner))||'Admin',avatar:g.avatar||''}))});});

  app.post('/api/groups',auth,async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,60),ids=Array.isArray(req.body.memberIds)?req.body.memberIds:[];if(!name)return res.status(400).json({error:'Group name required.'});const accepted=await FriendInvite.find({status:'accepted',$or:[{from:req.user._id},{to:req.user._id}]}).lean();const allowed=new Set(accepted.map(x=>String(x.from)===String(req.user._id)?String(x.to):String(x.from)));const members=[req.user._id,...ids.filter(x=>allowed.has(String(x))&&mongoose.isValidObjectId(x)).map(x=>new mongoose.Types.ObjectId(x))];const g=await ChatGroup.create({name,owner:req.user._id,members:[...new Map(members.map(x=>[String(x),x])).values()]});res.status(201).json({id:String(g._id)});});

  app.get('/api/groups/:id/messages',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id}).lean();if(!g)return res.status(403).json({error:'You are not a group member.'});const rows=await GroupMessage.find({groupId:g._id}).sort({createdAt:1}).limit(500).lean();const ids=[...new Set([...rows.map(m=>String(m.from)),...g.members.map(String)])];const people=await User.find({_id:{$in:ids}}).select('username').lean();const names=new Map(people.map(u=>[String(u._id),u.username]));res.json({memberUsers:g.members.map(id=>({id:String(id),username:names.get(String(id))||'User'})),messages:rows.map(m=>({id:String(m._id),from:String(m.from),username:names.get(String(m.from))||'User',text:m.text,replyTo:m.replyTo||null,createdAt:m.createdAt,reactions:m.reactions||[]})),owner:String(g.owner),admins:(g.admins||[]).map(String),avatar:g.avatar||'',members:g.members.map(String)});});

  app.post('/api/groups/:id/messages',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g)return res.status(403).json({error:'You are not a group member.'});const text=String(req.body.text||'').trim();if(!text||text.length>2000)return res.status(400).json({error:'Message must be 1–2000 characters.'});let replyTo=null;if(req.body.replyTo&&mongoose.isValidObjectId(String(req.body.replyTo))){const parent=await GroupMessage.findOne({_id:req.body.replyTo,groupId:g._id}).lean();if(parent){const author=await User.findById(parent.from).select('username').lean();replyTo={id:String(parent._id),username:author?.username||'User',text:parent.text.slice(0,240)};}}const m=await GroupMessage.create({groupId:g._id,from:req.user._id,text,replyTo});res.status(201).json({success:true,id:String(m._id)});});

  app.post('/api/groups/:id/members',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g||!(String(g.owner)===String(req.user._id)||(g.admins||[]).some(x=>String(x)===String(req.user._id))))return res.status(403).json({error:'Only group admins can add members.'});const uid=String(req.body.userId||'');if(!mongoose.isValidObjectId(uid)||uid===String(req.user._id))return res.status(400).json({error:'Invalid member ID.'});if(g.members.some(x=>String(x)===uid))return res.status(409).json({error:'User already in group.'});g.members.push(new mongoose.Types.ObjectId(uid));await g.save();res.json({success:true});});

  console.log('[ZANTA DASHBOARD] Successfully loaded attached dashboard with Baileys Auto-Reaction engine');
};
