// ZANTA-XMD OFC secure MongoDB dashboard.
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

module.exports = function attachDashboard(app, options) {
  const { mongoose, requestPairCode, commandsDir } = options;
  const Schema = mongoose.Schema;
  const User = mongoose.models.ZantaWebUser || mongoose.model('ZantaWebUser', new Schema({
    email:{type:String,required:true,unique:true,lowercase:true,trim:true},
    username:{type:String,required:true,unique:true,trim:true,lowercase:true},
    passwordHash:{type:String,default:''}, passwordSalt:{type:String,default:''}, googleSub:{type:String,default:'',index:true},
    coins:{type:Number,default:0,min:0}, gems:{type:Number,default:0,min:0}, avatar:{type:String,default:'',maxlength:4200000}, theme:{type:String,enum:['blue','purple','green','red','gold'],default:'blue'}, language:{type:String,enum:['en','si','ta','zh','ja','ar','ko'],default:'en'}, timezone:{type:String,default:'Asia/Colombo|Sri Lanka'}, deviceMode:{type:String,enum:['phone','desktop'],default:'phone'}, lastDailyOfferDay:{type:String,default:''}, lastDailyGemDay:{type:String,default:''}, lastDiceAt:{type:Date,default:null}, lastDevGiftDay:{type:String,default:''}, gameRewardDay:{type:String,default:''}, taskClaims:{type:[String],default:[]}, unlockedApps:{type:[String],default:[]}, lastDaily:{type:String,default:''},
    createdAt:{type:Date,default:Date.now}, hidden:{type:Boolean,default:false}, lastSeen:{type:Date,default:null}, onlineUntil:{type:Date,default:null}
  },{collection:'zanta_web_users'}));
  const EmailOtp = mongoose.models.ZantaEmailOtp || mongoose.model('ZantaEmailOtp', new Schema({email:{type:String,required:true,index:true},codeHash:{type:String,required:true},expiresAt:{type:Date,required:true,index:{expires:0}},lastSentAt:{type:Date,default:Date.now},attempts:{type:Number,default:0}},{collection:'zanta_email_otps'}));
  const Session = mongoose.models.ZantaWebSession || mongoose.model('ZantaWebSession',new Schema({
    tokenHash:{type:String,unique:true,required:true},userId:{type:Schema.Types.ObjectId,required:true,index:true},
    expiresAt:{type:Date,required:true,index:{expires:0}}
  },{collection:'zanta_web_sessions'}));
  const AdminSession = mongoose.models.ZantaAdminSession || mongoose.model('ZantaAdminSession',new Schema({tokenHash:{type:String,unique:true},expiresAt:{type:Date,index:{expires:0}}},{collection:'zanta_admin_sessions'}));
  const PairAttempt = mongoose.models.ZantaPairAttempt || mongoose.model('ZantaPairAttempt',new Schema({userId:{type:Schema.Types.ObjectId,unique:true,index:true,required:true},count:{type:Number,default:0},windowStartedAt:{type:Date,default:Date.now},blockedUntil:{type:Date,default:null}},{collection:'zanta_pair_attempts'}));
  const GameSession = mongoose.models.ZantaGameSession || mongoose.model('ZantaGameSession',new Schema({userId:{type:Schema.Types.ObjectId,index:true,required:true},tokenHash:{type:String,unique:true,required:true},game:{type:String,required:true},startedAt:{type:Date,default:Date.now},expiresAt:{type:Date,required:true,index:true},claimedAt:{type:Date,default:null}},{collection:'zanta_game_sessions'}));
  const RewardLedger = mongoose.models.ZantaRewardLedger || mongoose.model('ZantaRewardLedger',new Schema({userId:{type:Schema.Types.ObjectId,index:true,required:true},kind:{type:String,index:true,required:true},coins:{type:Number,default:0},gems:{type:Number,default:0},meta:{type:Schema.Types.Mixed,default:{}},createdAt:{type:Date,default:Date.now,index:true}},{collection:'zanta_reward_ledger'}));
  const Notice = mongoose.models.ZantaNotice || mongoose.model('ZantaNotice',new Schema({
    userId:{type:Schema.Types.ObjectId,index:true},kind:String,message:String,data:{type:Schema.Types.Mixed,default:{}},createdAt:{type:Date,default:Date.now},read:{type:Boolean,default:false}
  },{collection:'zanta_notices'}));
  const Config = mongoose.models.ZantaConfig || mongoose.model('ZantaConfig',new Schema({key:{type:String,unique:true},value:Schema.Types.Mixed},{collection:'zanta_config'}));
  const FriendInvite = mongoose.models.ZantaFriendInvite || mongoose.model('ZantaFriendInvite',new Schema({from:{type:Schema.Types.ObjectId,ref:'ZantaWebUser',required:true,index:true},to:{type:Schema.Types.ObjectId,ref:'ZantaWebUser',required:true,index:true},status:{type:String,enum:['pending','accepted','rejected'],default:'pending',index:true},createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}},{collection:'zanta_friend_invites'}));
  const PrivateMessage = mongoose.models.ZantaPrivateMessage || mongoose.model('ZantaPrivateMessage',new Schema({from:{type:Schema.Types.ObjectId,required:true,index:true},to:{type:Schema.Types.ObjectId,required:true,index:true},text:{type:String,required:true,maxlength:2000},replyTo:{type:Schema.Types.Mixed,default:null},reactions:{type:[{userId:Schema.Types.ObjectId,emoji:String}],default:[]},readAt:{type:Date,default:null},deleted:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now,index:true}},{collection:'zanta_private_messages'}));
  const ChatGroup = mongoose.models.ZantaChatGroup || mongoose.model('ZantaChatGroup',new Schema({name:{type:String,required:true,maxlength:60},owner:{type:Schema.Types.ObjectId,required:true,index:true},members:[Schema.Types.ObjectId],admins:{type:[Schema.Types.ObjectId],default:[]},avatar:{type:String,default:''},createdAt:{type:Date,default:Date.now}},{collection:'zanta_chat_groups'}));
  const GroupMessage = mongoose.models.ZantaGroupMessage || mongoose.model('ZantaGroupMessage',new Schema({groupId:{type:Schema.Types.ObjectId,index:true},from:{type:Schema.Types.ObjectId,index:true},text:{type:String,required:true,maxlength:2000},replyTo:{type:Schema.Types.Mixed,default:null},reactions:{type:[{userId:Schema.Types.ObjectId,emoji:String}],default:[]},deleted:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now}},{collection:'zanta_group_messages'}));
  async function ensureSupportGroup(){let owner=await User.findOne({email:GAME_OWNER_EMAIL}).select('_id').lean();if(!owner)owner=await User.findOne({}).select('_id').sort({createdAt:1}).lean();if(!owner)return null;let g=await ChatGroup.findOne({name:'Zanta Support Team'});if(!g)g=await ChatGroup.create({name:'Zanta Support Team',owner:owner._id,members:[owner._id]});const users=await User.find({hidden:{$ne:true}}).select('_id').limit(1000).lean();const ids=users.map(u=>u._id);if(ids.length)await ChatGroup.updateOne({_id:g._id},{$addToSet:{members:{$each:ids}}});return g;}
  const SupportTicket = mongoose.models.ZantaSupportTicket || mongoose.model('ZantaSupportTicket',new Schema({userId:{type:Schema.Types.ObjectId,index:true},username:String,email:String,subject:{type:String,default:'Support request'},message:{type:String,required:true,maxlength:2000},reply:{type:String,default:''},repliedAt:{type:Date,default:null},repliedBy:{type:String,default:''},createdAt:{type:Date,default:Date.now},status:{type:String,default:'open'}},{collection:'zanta_support_tickets'}));
  const FeedPost = mongoose.models.ZantaFeedPost || mongoose.model('ZantaFeedPost',new Schema({author:{type:Schema.Types.ObjectId,required:true,index:true},text:{type:String,default:'',maxlength:5000},mediaUrl:{type:String,default:'',maxlength:300000},mediaType:{type:String,enum:['image','video',''],default:''},likes:{type:[Schema.Types.ObjectId],default:[]},comments:{type:[{userId:Schema.Types.ObjectId,text:{type:String,maxlength:500},createdAt:{type:Date,default:Date.now}}],default:[]},createdAt:{type:Date,default:Date.now,index:true},updatedAt:{type:Date,default:Date.now}},{collection:'zanta_feed_posts'}));
  const COOKIE='zanta_session', hash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const isOwnerIdentity=email=>String(email||'').trim().toLowerCase()===String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const GAME_OWNER_EMAIL=String(process.env.OWNER_EMAIL||'zantaxmd2@gmail.com').trim().toLowerCase();
  const isGameOwner=u=>String(u?.email||'').trim().toLowerCase()===GAME_OWNER_EMAIL;
  const cleanUser=u=>({id:String(u._id),email:u.email,username:u.username,coins:u.coins,gems:u.gems||0,avatar:u.avatar||'',theme:u.theme||'blue',language:u.language||'en',timezone:u.timezone||'Asia/Colombo|Sri Lanka',deviceMode:u.deviceMode||'phone',taskClaims:u.taskClaims||[],lastDailyOfferDay:u.lastDailyOfferDay||'',lastDailyGemDay:u.lastDailyGemDay||'',lastDiceAt:u.lastDiceAt||null,lastDevGiftDay:u.lastDevGiftDay||'',createdAt:u.createdAt,verified:!!u.verified||isOwnerIdentity(u.email)});
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
  app.get('/',(req,res)=>{res.set({'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate','Pragma':'no-cache','Expires':'0','Surrogate-Control':'no-store'});res.sendFile(require('path').join(__dirname,'public','index.html'));});
  app.get('/userloding.html',(req,res)=>res.sendFile(require('path').join(__dirname,'userloding.html')));
  app.get('/adminloding.html',(req,res)=>res.sendFile(require('path').join(__dirname,'adminloding.html')));
  app.get('/admin',(req,res)=>res.sendFile(require('path').join(__dirname,'admin.html')));
  app.get('/admin.html',(req,res)=>res.sendFile(require('path').join(__dirname,'admin.html')));
  app.get('/shop',(req,res)=>res.sendFile(require('path').join(__dirname,'public','shop.html')));
  app.get('/shop.html',(req,res)=>res.sendFile(require('path').join(__dirname,'public','shop.html')));
  app.get('/ai',(req,res)=>res.sendFile(require('path').join(__dirname,'public','ai.html')));
  app.get('/ai.html',(req,res)=>res.sendFile(require('path').join(__dirname,'public','ai.html')));
  app.get('/game/game.html',(req,res)=>{res.set('Cache-Control','no-store');res.sendFile(require('path').join(__dirname,'public','game','game.html'));});
  // Contact menu image assets
  app.get('/contact-icons.png',(req,res)=>res.sendFile(require('path').join(__dirname,'public','contact-icons.png')));
  app.get('/floating-contact.png',(req,res)=>res.sendFile(require('path').join(__dirname,'public','floating-contact.png')));
  // Serve the editable user dashboard from MongoDB when an admin has saved it.
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
  // Serve the same dashboard shell at the private owner-console URL.
  app.get('/pair',(req,res)=>res.sendFile(require('path').join(__dirname,'public','pair.html')));
  app.get('/support',(req,res)=>res.sendFile(require('path').join(__dirname,'public','support.html')));
  app.get('/api/support/members',auth,async(req,res)=>{try{await ensureSupportGroup();const users=await User.find({hidden:{$ne:true}}).select('username email verified createdAt').sort({createdAt:1}).limit(1000).lean();res.json({users:users.map(u=>({id:String(u._id),username:u.username,email:u.email,verified:!!u.verified}))});}catch(e){res.status(500).json({error:'Could not load support members.'})}});
  app.get('/zanta-owner-console-7f3a',(req,res)=>res.sendFile(require('path').join(__dirname,'public','index.html')));
  // OAuth Client ID is public by design; env var can override this default.
  const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '1069665681737-151ruk70qcma4gcp8s7bn62jmg3oe80b.apps.googleusercontent.com');
  app.get('/api/auth/config',(req,res)=>res.json({googleClientId:GOOGLE_CLIENT_ID}));
  // Gmail SMTP email verification. Configure SMTP_USER and SMTP_APP_PASSWORD in Heroku Config Vars.
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
    const salt=crypto.randomBytes(16).toString('hex'),passwordHash=await passHash(p,salt);const u=await User.create({email,username,passwordHash,passwordSalt:salt});await ensureSupportGroup();await EmailOtp.deleteMany({email});await session(res,req,u);res.status(201).json({user:cleanUser(u)});
  }catch(e){console.error('[OTP registration]',e);res.status(500).json({error:'Could not create account.'});}});
  app.post('/api/auth/google',async(req,res)=>{try{const credential=String(req.body.credential||'');const username=String(req.body.username||'').trim().toLowerCase();if(!credential)return res.status(400).json({error:'Choose a Google account first.'});if(!usernameOk(username))return res.status(400).json({error:'Username must start with @ and contain 4–21 characters.'});const verify=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(credential));if(!verify.ok)return res.status(401).json({error:'Google sign-in could not be verified.'});const claims=await verify.json();const clientId=GOOGLE_CLIENT_ID;if(!clientId||claims.aud!==clientId||claims.email_verified!=='true'||Number(claims.exp)*1000<Date.now())return res.status(401).json({error:'Google account verification failed. Check GOOGLE_CLIENT_ID.'});const email=String(claims.email||'').trim().toLowerCase();let u=await User.findOne({$or:[{googleSub:String(claims.sub)},{email}]});if(u){if(u.username!==username&&await User.exists({username}))return res.status(409).json({error:'That username is already taken.'});if(u.username!==username){u.username=username;await u.save();}}else{if(await User.exists({username}))return res.status(409).json({error:'That username is already taken.'});u=await User.create({email,username,googleSub:String(claims.sub)});await ensureSupportGroup();}await session(res,req,u);res.json({user:cleanUser(u)});}catch(e){console.error('[Google auth]',e);res.status(500).json({error:'Google sign-in failed.'});}});
  app.get('/api/auth/me',async(req,res)=>{try{const u=await current(req);res.json({authenticated:!!u,user:u?cleanUser(u):null});}catch{res.status(503).json({error:'Database unavailable'});}});
  app.post('/api/auth/register',(req,res)=>res.status(403).json({error:'Direct registration is disabled. Verify your Gmail with OTP first.'}));
  app.post('/api/auth/login',async(req,res)=>{try{const id=String(req.body.identity||'').trim().toLowerCase(),p=String(req.body.password||'');const u=await User.findOne({$or:[{email:id},{username:id}]});if(!u||!u.passwordHash||!u.passwordSalt||!crypto.timingSafeEqual(Buffer.from(await passHash(p,u.passwordSalt),'hex'),Buffer.from(u.passwordHash,'hex')))return res.status(401).json({error:'Invalid login details.'});await session(res,req,u);res.json({user:cleanUser(u)});}catch{res.status(500).json({error:'Login failed.'});}});
  app.post('/api/auth/logout',async(req,res)=>{const t=token(req);if(t)await Session.deleteOne({tokenHash:hash(t)});res.setHeader('Set-Cookie',cookie(req,0));res.json({success:true});});
  app.get('/api/dashboard',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10);const notices=await Notice.find({$or:[{userId:req.user._id},{userId:null}]}).sort({createdAt:-1}).limit(30).lean();const [appsRow,uiRow]=await Promise.all([Config.findOne({key:'apps'}).lean(),Config.findOne({key:'dashboardUI'}).lean()]);res.json({user:cleanUser(req.user),dailyAvailable:req.user.lastDaily!==day,notices, dashboardUI:uiRow?.value||{},apps:(appsRow?.value||[]).map(a=>({...a,unlocked:req.user.unlockedApps.includes(String(a.id||a.name))}))});});
  app.get('/api/settings',auth,async(req,res)=>{res.json({settings:{theme:req.user.theme||'blue',language:req.user.language||'en',timezone:req.user.timezone||'Asia/Colombo|Sri Lanka',deviceMode:req.user.deviceMode||'phone',avatar:req.user.avatar||''}});});
  app.put('/api/settings',auth,async(req,res)=>{try{const allowedThemes=['blue','purple','green','red','gold'],allowedLanguages=['en','si','ta','zh','ja','ar','ko'],allowedModes=['phone','desktop'];const patch={};if(req.body.theme!==undefined){const v=String(req.body.theme);if(!allowedThemes.includes(v))return res.status(400).json({error:'Invalid theme.'});patch.theme=v;}if(req.body.language!==undefined){const v=String(req.body.language);if(!allowedLanguages.includes(v))return res.status(400).json({error:'Invalid language.'});patch.language=v;}if(req.body.timezone!==undefined){const v=String(req.body.timezone).trim();if(!v||v.length>120||!v.includes('|'))return res.status(400).json({error:'Invalid timezone.'});patch.timezone=v;}if(req.body.deviceMode!==undefined){const v=String(req.body.deviceMode);if(!allowedModes.includes(v))return res.status(400).json({error:'Invalid device mode.'});patch.deviceMode=v;}if(req.body.avatar!==undefined){const v=String(req.body.avatar||'');if(v.length>4200000||(v&&!/^data:image\/(png|jpeg|webp|gif);base64,/.test(v)))return res.status(400).json({error:'Invalid profile image.'});patch.avatar=v;}const u=await User.findByIdAndUpdate(req.user._id,{$set:patch},{new:true});res.json({user:cleanUser(u),settings:{theme:u.theme,language:u.language,timezone:u.timezone,deviceMode:u.deviceMode,avatar:u.avatar||''}});}catch(e){res.status(500).json({error:'Could not save settings.'});}});
  app.post('/api/notifications/read-all',auth,async(req,res)=>{await Notice.updateMany({$or:[{userId:req.user._id},{userId:null}],read:false},{$set:{read:true}});res.json({success:true});});
  app.get('/api/rewards/history',auth,async(req,res)=>{const rows=await RewardLedger.find({userId:req.user._id}).sort({createdAt:-1}).limit(100).lean();res.json({history:rows});});
  // Facebook-style social feed. Posts live in a separate MongoDB collection so existing bot/session data is untouched.
  app.get('/api/feed',auth,async(req,res)=>{
    try{
      const posts=await FeedPost.find({}).sort({createdAt:-1}).limit(100).lean();
      const ids=[...new Set(posts.map(p=>String(p.author)).concat(posts.flatMap(p=>(p.comments||[]).map(c=>String(c.userId)))) )].filter(mongoose.isValidObjectId);
      const users=await User.find({_id:{$in:ids}}).select('username email verified').lean();
      const um=new Map(users.map(u=>[String(u._id),u]));
      const out=posts.map(p=>({id:String(p._id),text:p.text||'',mediaUrl:p.mediaUrl||'',mediaType:p.mediaType||'',createdAt:p.createdAt,liked:(p.likes||[]).some(x=>String(x)===String(req.user._id)),likes:(p.likes||[]).length,canDelete:String(p.author)===String(req.user._id),author:{id:String(p.author),username:um.get(String(p.author))?.username||'@user',verified:!!um.get(String(p.author))?.verified||isOwnerIdentity(um.get(String(p.author))?.email)},comments:(p.comments||[]).slice(-50).map(c=>({id:String(c._id),text:c.text,createdAt:c.createdAt,userId:String(c.userId),username:um.get(String(c.userId))?.username||'@user',verified:!!um.get(String(c.userId))?.verified||isOwnerIdentity(um.get(String(c.userId))?.email)}))}));
      res.json({posts:out});
    }catch(e){console.error('[Feed GET]',e);res.status(500).json({error:'Could not load feed.'});}
  });
  app.post('/api/feed',auth,async(req,res)=>{
    try{
      const text=String(req.body.text||'').trim().slice(0,5000);
      const mediaUrl=String(req.body.mediaUrl||'').trim().slice(0,300000);
      const mediaType=['image','video'].includes(String(req.body.mediaType||''))?String(req.body.mediaType):'';
      if(!text&&!mediaUrl)return res.status(400).json({error:'Write something or add media first.'});
      if(mediaUrl && !/^(https?:\/\/|data:image\/|data:video\/)/i.test(mediaUrl))return res.status(400).json({error:'Media must be an http(s) URL or a supported data URL.'});
      const post=await FeedPost.create({author:req.user._id,text,mediaUrl,mediaType});
      res.status(201).json({success:true,id:String(post._id)});
    }catch(e){console.error('[Feed POST]',e);res.status(500).json({error:'Could not create post.'});}
  });
  app.post('/api/feed/:id/like',auth,async(req,res)=>{
    try{const post=await FeedPost.findById(req.params.id);if(!post)return res.status(404).json({error:'Post not found.'});const i=post.likes.findIndex(x=>String(x)===String(req.user._id));if(i>=0)post.likes.splice(i,1);else post.likes.push(req.user._id);await post.save();res.json({liked:i<0,likes:post.likes.length});}
    catch(e){res.status(500).json({error:'Could not update like.'});}
  });
  app.post('/api/feed/:id/comments',auth,async(req,res)=>{
    try{const text=String(req.body.text||'').trim().slice(0,500);if(!text)return res.status(400).json({error:'Comment cannot be empty.'});const post=await FeedPost.findById(req.params.id);if(!post)return res.status(404).json({error:'Post not found.'});post.comments.push({userId:req.user._id,text});await post.save();res.json({success:true});}
    catch(e){res.status(500).json({error:'Could not add comment.'});}
  });
  app.delete('/api/feed/:id',auth,async(req,res)=>{
    try{const post=await FeedPost.findOneAndDelete({_id:req.params.id,author:req.user._id});if(!post)return res.status(404).json({error:'Post not found or not yours.'});res.json({success:true});}
    catch(e){res.status(500).json({error:'Could not delete post.'});}
  });
  // User directory, friend invitations and private MongoDB chat.
  app.get('/api/users',auth,async(req,res)=>{const users=await User.find({_id:{$ne:req.user._id},hidden:{$ne:true}}).select('username createdAt').sort({username:1}).limit(500).lean();const ids=users.map(u=>u._id);const relations=await FriendInvite.find({$or:[{from:req.user._id,to:{$in:ids}},{to:req.user._id,from:{$in:ids}}]}).lean();const map=new Map();for(const r of relations){const other=String(r.from)===String(req.user._id)?String(r.to):String(r.from);const prev=map.get(other);const rank={rejected:0,pending:1,accepted:2};if(!prev||(rank[r.status]||0)>(rank[prev.status]||0))map.set(other,{status:r.status,inviteId:String(r._id),outgoing:String(r.from)===String(req.user._id)});}res.json({users:users.map(u=>({id:String(u._id),username:u.username,relation:map.get(String(u._id))||null}))});});
  app.post('/api/invites',auth,async(req,res)=>{const target=String(req.body.userId||'');if(!mongoose.isValidObjectId(target)||target===String(req.user._id))return res.status(400).json({error:'Choose a valid user.'});if(!await User.exists({_id:target}))return res.status(404).json({error:'User not found.'});const existing=await FriendInvite.findOne({$or:[{from:req.user._id,to:target},{from:target,to:req.user._id}]}).sort({createdAt:-1});if(existing&&existing.status==='accepted')return res.status(409).json({error:'You are already connected.'});if(existing&&existing.status==='pending')return res.status(409).json({error:'An invitation is already pending.'});const invite=await FriendInvite.create({from:req.user._id,to:target});await Notice.create({userId:target,kind:'friend_invite',message:`${req.user.username} invited you to chat.`,data:{inviteId:String(invite._id),fromUserId:String(req.user._id),fromUsername:req.user.username}});res.status(201).json({success:true});});
  app.post('/api/invites/:id/respond',auth,async(req,res)=>{const action=String(req.body.action||'');if(!['accept','reject'].includes(action))return res.status(400).json({error:'Invalid response.'});const invite=await FriendInvite.findOne({_id:req.params.id,to:req.user._id,status:'pending'});if(!invite)return res.status(404).json({error:'Invitation not found.'});invite.status=action==='accept'?'accepted':'rejected';invite.updatedAt=new Date();await invite.save();await Notice.create({userId:invite.from,kind:action==='accept'?'invite_accepted':'invite_rejected',message:action==='accept'?`${req.user.username} accepted your chat invitation.`:`${req.user.username} declined your chat invitation.`,data:{userId:String(req.user._id),username:req.user.username}});res.json({success:true,status:invite.status});});
  app.get('/api/friends',auth,async(req,res)=>{const rows=await FriendInvite.find({status:'accepted',$or:[{from:req.user._id},{to:req.user._id}]}).sort({updatedAt:-1}).lean();const ids=rows.map(r=>String(r.from)===String(req.user._id)?r.to:r.from);const users=await User.find({_id:{$in:ids},hidden:{$ne:true}}).select('username lastSeen onlineUntil').lean();res.json({friends:users.map(u=>({id:String(u._id),username:u.username,isOnline:!!(u.onlineUntil&&u.onlineUntil>new Date()),lastSeen:u.lastSeen||null}))});});
  async function connected(a,b){return !!await FriendInvite.exists({status:'accepted',$or:[{from:a,to:b},{from:b,to:a}]});}
  app.post('/api/presence/heartbeat',auth,async(req,res)=>{const now=new Date();await User.updateOne({_id:req.user._id},{$set:{lastSeen:now,onlineUntil:new Date(now.getTime()+45000)}});res.json({success:true,at:now});});
  app.get('/api/chat/:userId',auth,async(req,res)=>{const other=req.params.userId;if(!mongoose.isValidObjectId(other)||!(await connected(req.user._id,other)))return res.status(403).json({error:'Chat is available only after an invitation is accepted.'});const now=new Date();await PrivateMessage.updateMany({from:other,to:req.user._id,readAt:null},{$set:{readAt:now}});const [messages,people]=await Promise.all([PrivateMessage.find({$or:[{from:req.user._id,to:other},{from:other,to:req.user._id}]}).sort({createdAt:1}).limit(300).lean(),User.find({_id:{$in:[req.user._id,other]}}).select('username lastSeen onlineUntil').lean()]);const names=new Map(people.map(u=>[String(u._id),u.username]));const peer=people.find(u=>String(u._id)===String(other));res.json({peer:{isOnline:!!(peer?.onlineUntil&&peer.onlineUntil>now),lastSeen:peer?.lastSeen||null},messages:messages.map(m=>({id:String(m._id),from:String(m.from),username:names.get(String(m.from))||'User',text:m.text,replyTo:m.replyTo||null,createdAt:m.createdAt,readAt:m.readAt||null,reactions:m.reactions||[]}))});});
  app.post('/api/chat/:userId',auth,async(req,res)=>{const other=req.params.userId,text=String(req.body.text||'').trim();if(!mongoose.isValidObjectId(other)||!(await connected(req.user._id,other)))return res.status(403).json({error:'Chat is available only with an accepted contact.'});if(!text||text.length>2000)return res.status(400).json({error:'Message must be 1–2000 characters.'});let replyTo=null;if(req.body.replyTo&&mongoose.isValidObjectId(String(req.body.replyTo))){const parent=await PrivateMessage.findOne({_id:req.body.replyTo,$or:[{from:req.user._id,to:other},{from:other,to:req.user._id}]}).lean();if(parent){const author=await User.findById(parent.from).select('username').lean();replyTo={id:String(parent._id),username:author?.username||'User',text:parent.text.slice(0,240)};}}const message=await PrivateMessage.create({from:req.user._id,to:other,text,replyTo});res.status(201).json({message:{id:String(message._id),from:String(message.from),text:message.text,createdAt:message.createdAt}});});
  app.post('/api/rewards/claim',auth,async(req,res)=>{try{const task=String(req.body.task||'');if(!['youtube','whatsapp'].includes(task))return res.status(400).json({error:'Invalid reward task.'});const reward=50;const u=await User.findOneAndUpdate({_id:req.user._id,taskClaims:{$ne:task}},{$inc:{coins:reward},$addToSet:{taskClaims:task}},{new:true});if(!u)return res.status(409).json({error:'This reward has already been claimed.'});await RewardLedger.create({userId:u._id,kind:task,coins:reward});await Notice.create({userId:u._id,kind:'coin',message:`${task==='youtube'?'YouTube subscribe':'WhatsApp Channel follow'} reward: +${reward} coins`});res.json({success:true,reward,user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not claim reward.'});}});
  app.post('/api/offers/daily-coin',auth,async(req,res)=>{try{const day=new Date().toISOString().slice(0,10),reward=Math.floor(Math.random()*5)*10+10;const u=await User.findOneAndUpdate({_id:req.user._id,lastDailyOfferDay:{$ne:day}},{$inc:{coins:reward},$set:{lastDailyOfferDay:day}},{new:true});if(!u)return res.status(409).json({error:'You have already claimed today\'s coins.'});await RewardLedger.create({userId:u._id,kind:'daily-coin',coins:reward,meta:{day}});res.json({reward,user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not claim daily coins.'});}});
  app.post('/api/offers/daily-gem',auth,async(req,res)=>{try{const day=new Date().toISOString().slice(0,10),reward=Math.floor(Math.random()*10)+1;const u=await User.findOneAndUpdate({_id:req.user._id,lastDailyGemDay:{$ne:day}},{$inc:{gems:reward},$set:{lastDailyGemDay:day}},{new:true});if(!u)return res.status(409).json({error:'You have already claimed today\'s gems.'});await RewardLedger.create({userId:u._id,kind:'daily-gem',gems:reward,meta:{day}});res.json({reward,user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not claim daily gems.'});}});
  app.post('/api/offers/task',auth,async(req,res)=>{try{const task=String(req.body.task||'');if(task==='whatsapp'){const u=await User.findOneAndUpdate({_id:req.user._id,taskClaims:{$ne:'whatsapp'}},{$inc:{coins:50,gems:5},$addToSet:{taskClaims:'whatsapp'}},{new:true});if(!u)return res.status(409).json({error:'WhatsApp reward already claimed.'});await RewardLedger.create({userId:u._id,kind:'whatsapp',coins:50,gems:5});return res.json({user:cleanUser(u)});}if(task==='youtube'){const u=await User.findOneAndUpdate({_id:req.user._id,taskClaims:{$ne:'youtube'}},{$inc:{coins:50,gems:10},$addToSet:{taskClaims:'youtube'}},{new:true});if(!u)return res.status(409).json({error:'YouTube reward already claimed.'});await RewardLedger.create({userId:u._id,kind:'youtube',coins:50,gems:10});return res.json({user:cleanUser(u)});}return res.status(400).json({error:'Invalid reward task.'});}catch(e){res.status(500).json({error:'Could not claim reward.'});}});
  app.post('/api/offers/dice',auth,async(req,res)=>{try{const now=Date.now(),twoDays=172800000;const last=req.user.lastDiceAt?.getTime?.()||0;if(last&&now-last<twoDays){const hours=Math.ceil((twoDays-(now-last))/3600000);return res.status(429).json({error:`Dice can be rolled again in ${hours} hour(s).`});}const roll=Math.floor(Math.random()*6)+1,coins=roll*10,gems=roll*2;const u=await User.findByIdAndUpdate(req.user._id,{$inc:{coins,gems},$set:{lastDiceAt:new Date(now)}},{new:true});await RewardLedger.create({userId:u._id,kind:'dice',coins,gems,meta:{roll}});res.json({roll,coins,gems,user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not roll dice.'});}});
  app.post('/api/offers/dev-gift',auth,async(req,res)=>{try{const day=new Date().toISOString().slice(0,10);const u=await User.findOneAndUpdate({_id:req.user._id,lastDevGiftDay:{$ne:day}},{$inc:{coins:100,gems:20},$set:{lastDevGiftDay:day}},{new:true});if(!u)return res.status(409).json({error:'Today\'s developer gift has already been claimed.'});await RewardLedger.create({userId:u._id,kind:'dev-gift',coins:100,gems:20,meta:{day}});res.json({user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not claim developer gift.'});}});
  app.post('/api/daily',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10),rewards=[20,30,40,50,100,150],reward=rewards[Math.floor(Math.random()*rewards.length)];const u=await User.findOneAndUpdate({_id:req.user._id,lastDaily:{$ne:day}},{$inc:{coins:reward},$set:{lastDaily:day}},{new:true});if(!u)return res.status(409).json({error:'Daily reward already claimed.'});await RewardLedger.create({userId:u._id,kind:'daily',coins:reward,meta:{day}});await Notice.create({userId:u._id,kind:'coin',message:`Daily reward: +${reward} coins`});res.json({reward,user:cleanUser(u)});});
  app.post('/api/apps/unlock',auth,async(req,res)=>{const id=String(req.body.id||'');const row=await Config.findOne({key:'apps'}).lean();const app=(row?.value||[]).find(a=>String(a.id||a.name)===id);if(!app)return res.status(404).json({error:'App not found.'});if(req.user.unlockedApps.includes(id))return res.json({success:true,alreadyUnlocked:true});const price=Math.max(1,Number(app.price)||200);const u=await User.findOneAndUpdate({_id:req.user._id,coins:{$gte:price}},{$inc:{coins:-price},$addToSet:{unlockedApps:id}},{new:true});if(!u)return res.status(400).json({error:'Not enough coins.'});await Notice.create({userId:u._id,kind:'app',message:`Unlocked ${app.name}`});res.json({success:true,user:cleanUser(u),url:app.url||''});});
  app.post('/api/ai/chat',auth,async(req,res)=>{try{const key=String(process.env.OPENROUTER_API_KEY||'').trim();if(!key)return res.status(503).json({error:'ZANTA AI is not configured on the server.'});const messages=Array.isArray(req.body.messages)?req.body.messages.slice(-12).map(m=>({role:m?.role==='assistant'?'assistant':'user',content:String(m?.content||'').slice(0,4000)})).filter(m=>m.content):[];if(!messages.length)return res.status(400).json({error:'Message is required.'});const endpoint=process.env.OPENROUTER_ENDPOINT||'https://openrouter.ai/api/v1/chat/completions';const model=process.env.OPENROUTER_MODEL||'meta-llama/llama-3.3-70b-instruct';const prompt=[{role:'system',content:'You are ZANTA AI, the helpful AI assistant inside ZANTA-XMD. Be concise, friendly and accurate. If the user writes Sinhala, reply naturally in Sinhala.'},...messages];const r=await fetch(endpoint,{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':process.env.DASHBOARD_URL||'http://localhost:3000','X-Title':'ZANTA AI'},body:JSON.stringify({model,messages:prompt,temperature:.7,max_tokens:900})});const d=await r.json().catch(()=>({}));if(!r.ok)return res.status(502).json({error:d?.error?.message||'AI provider request failed.'});const text=d?.choices?.[0]?.message?.content;if(!text)return res.status(502).json({error:'AI returned an empty response.'});res.json({success:true,message:text,model});}catch(e){console.error('[ZANTA AI]',e);res.status(500).json({error:'ZANTA AI request failed.'});}});
  app.post('/api/support',auth,async(req,res)=>{try{const subject=String(req.body.subject||'Support request').trim().slice(0,100),message=String(req.body.message||'').trim().slice(0,2000);if(message.length<3)return res.status(400).json({error:'Please enter a longer message.'});const ticket=await SupportTicket.create({userId:req.user._id,username:req.user.username,email:req.user.email,subject,message});res.status(201).json({success:true,ticketId:String(ticket._id)});}catch(e){res.status(500).json({error:'Could not send support message.'});}});
  // Admin-only Developer Support Inbox API.
  // Keep this route in the backend (not only in the dashboard HTML).
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
      return res.status(500).json({ error: 'Could not load support inbox. Check MongoDB connection and zanta_support_tickets collection.' });
    }
  });
  console.log('[ZANTA DASHBOARD] Registered GET /api/admin/support');
  app.post('/api/admin/support/:id/reply', requireAdmin, async (req,res) => {try{const message=String(req.body.message||'').trim().slice(0,2000);if(message.length<1)return res.status(400).json({error:'Reply message is required.'});const ticket=await SupportTicket.findById(req.params.id);if(!ticket)return res.status(404).json({error:'Support ticket not found.'});ticket.reply=message;ticket.repliedAt=new Date();ticket.repliedBy='@zanta000';ticket.status='replied';await ticket.save();if(ticket.userId)await Notice.create({userId:ticket.userId,kind:'support_reply',message:`DEVLOPER @zanta000 ✓ replied to your support message: ${message.slice(0,180)}`,data:{ticketId:String(ticket._id),verified:true,developer:'@zanta000'}});res.json({success:true});}catch(e){console.error('[ZANTA SUPPORT INBOX] Reply failed:',e);res.status(500).json({error:'Could not send support reply.'});}});

  app.post('/api/chat/:userId/:messageId/react',auth,async(req,res)=>{const other=req.params.userId,id=req.params.messageId,emoji=String(req.body.emoji||'').slice(0,12);if(!['❤️','😂','😮','😢','🔥','👍','👏'].includes(emoji))return res.status(400).json({error:'Unsupported reaction.'});if(!(await connected(req.user._id,other)))return res.status(403).json({error:'Not connected.'});const m=await PrivateMessage.findOne({_id:id,$or:[{from:req.user._id,to:other},{from:other,to:req.user._id}]});if(!m)return res.status(404).json({error:'Message not found.'});m.reactions=m.reactions.filter(r=>String(r.userId)!==String(req.user._id));m.reactions.push({userId:req.user._id,emoji});await m.save();res.json({success:true});});
  app.delete('/api/chat/:userId/:messageId',auth,async(req,res)=>{const other=req.params.userId;if(!(await connected(req.user._id,other)))return res.status(403).json({error:'Not connected.'});const m=await PrivateMessage.findOne({_id:req.params.messageId,from:req.user._id,to:other});if(!m)return res.status(404).json({error:'Only your own message can be deleted.'});m.deleted=true;m.text='This message was deleted';await m.save();res.json({success:true});});
  app.get('/api/groups',auth,async(req,res)=>{const groups=await ChatGroup.find({members:req.user._id}).sort({createdAt:-1}).lean();const owners=groups.map(g=>g.owner);const users=await User.find({_id:{$in:owners}}).select('username').lean();const um=new Map(users.map(u=>[String(u._id),u.username]));res.json({groups:groups.map(g=>({id:String(g._id),name:g.name,members:g.members.length,owner:String(g.owner),ownerName:um.get(String(g.owner))||'Admin',avatar:g.avatar||''}))});});
  app.post('/api/groups',auth,async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,60),ids=Array.isArray(req.body.memberIds)?req.body.memberIds:[];if(!name)return res.status(400).json({error:'Group name required.'});const accepted=await FriendInvite.find({status:'accepted',$or:[{from:req.user._id},{to:req.user._id}]}).lean();const allowed=new Set(accepted.map(x=>String(x.from)===String(req.user._id)?String(x.to):String(x.from)));const members=[req.user._id,...ids.filter(x=>allowed.has(String(x))&&mongoose.isValidObjectId(x)).map(x=>new mongoose.Types.ObjectId(x))];const g=await ChatGroup.create({name,owner:req.user._id,members:[...new Map(members.map(x=>[String(x),x])).values()]});res.status(201).json({id:String(g._id)});});
  app.get('/api/groups/:id/messages',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id}).lean();if(!g)return res.status(403).json({error:'You are not a group member.'});const rows=await GroupMessage.find({groupId:g._id}).sort({createdAt:1}).limit(500).lean();const ids=[...new Set([...rows.map(m=>String(m.from)),...g.members.map(String)])];const people=await User.find({_id:{$in:ids}}).select('username').lean();const names=new Map(people.map(u=>[String(u._id),u.username]));res.json({memberUsers:g.members.map(id=>({id:String(id),username:names.get(String(id))||'User'})),messages:rows.map(m=>({id:String(m._id),from:String(m.from),username:names.get(String(m.from))||'User',text:m.text,replyTo:m.replyTo||null,createdAt:m.createdAt,reactions:m.reactions||[]})),owner:String(g.owner),admins:(g.admins||[]).map(String),avatar:g.avatar||'',members:g.members.map(String)});});
  app.post('/api/groups/:id/messages',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g)return res.status(403).json({error:'You are not a group member.'});const text=String(req.body.text||'').trim();if(!text||text.length>2000)return res.status(400).json({error:'Message must be 1–2000 characters.'});let replyTo=null;if(req.body.replyTo&&mongoose.isValidObjectId(String(req.body.replyTo))){const parent=await GroupMessage.findOne({_id:req.body.replyTo,groupId:g._id}).lean();if(parent){const author=await User.findById(parent.from).select('username').lean();replyTo={id:String(parent._id),username:author?.username||'User',text:parent.text.slice(0,240)};}}const m=await GroupMessage.create({groupId:g._id,from:req.user._id,text,replyTo});res.status(201).json({success:true,id:String(m._id)});});
  app.post('/api/groups/:id/members',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g||!(String(g.owner)===String(req.user._id)||(g.admins||[]).some(x=>String(x)===String(req.user._id))))return res.status(403).json({error:'Only group admins can add members.'});const uid=String(req.body.userId||'');if(!mongoose.isValidObjectId(uid)||uid===String(req.user._id))return res.status(400).json({error:'Choose a valid accepted friend.'});if(!await connected(req.user._id,uid))return res.status(403).json({error:'You can only add friends who accepted your invitation.'});await ChatGroup.updateOne({_id:g._id},{$addToSet:{members:new mongoose.Types.ObjectId(uid)}});res.json({success:true});});
  app.put('/api/groups/:id/members/:userId/role',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,owner:req.user._id});if(!g)return res.status(403).json({error:'Only the group owner can manage admins.'});const uid=req.params.userId;if(String(g.owner)===uid||!g.members.some(x=>String(x)===uid))return res.status(400).json({error:'Owner cannot be changed and target must be a member.'});if(req.body.admin===true)await ChatGroup.updateOne({_id:g._id},{$addToSet:{admins:new mongoose.Types.ObjectId(uid)}});else await ChatGroup.updateOne({_id:g._id},{$pull:{admins:new mongoose.Types.ObjectId(uid)}});res.json({success:true});});
  app.put('/api/groups/:id/profile',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g)return res.status(403).json({error:'Not a group member.'});if(req.body.avatar!==undefined){const v=String(req.body.avatar||'');if(v.length>1200000|| (v&&!/^data:image\/(png|jpeg|webp|gif);base64,/.test(v)))return res.status(400).json({error:'Invalid group image.'});g.avatar=v;}if(req.body.name!==undefined&&String(g.owner)===String(req.user._id)){const n=String(req.body.name).trim().slice(0,60);if(!n)return res.status(400).json({error:'Group name required.'});g.name=n;}await g.save();res.json({success:true,name:g.name,avatar:g.avatar||''});});
  app.delete('/api/groups/:id/members/:userId',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g||!(String(g.owner)===String(req.user._id)||(g.admins||[]).some(x=>String(x)===String(req.user._id))))return res.status(403).json({error:'Only group admins can remove members.'});const target=req.params.userId;if(String(g.owner)===target)return res.status(400).json({error:'The group owner cannot be removed.'});if(String(g.owner)!==String(req.user._id)&&(g.admins||[]).some(x=>String(x)===target))return res.status(403).json({error:'Admins cannot remove another admin.'});await ChatGroup.updateOne({_id:g._id},{$pull:{members:new mongoose.Types.ObjectId(target),admins:new mongoose.Types.ObjectId(target)}});res.json({success:true});});
  app.post('/api/groups/:id/messages/:messageId/react',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g)return res.status(403).json({error:'Not a group member.'});const emoji=String(req.body.emoji||'').slice(0,12);if(!['❤️','😂','😮','😢','🔥','👍','👏'].includes(emoji))return res.status(400).json({error:'Unsupported reaction.'});const m=await GroupMessage.findOne({_id:req.params.messageId,groupId:g._id});if(!m)return res.status(404).json({error:'Message not found.'});m.reactions=m.reactions.filter(r=>String(r.userId)!==String(req.user._id));m.reactions.push({userId:req.user._id,emoji});await m.save();res.json({success:true});});
  app.delete('/api/groups/:id/messages/:messageId',auth,async(req,res)=>{const g=await ChatGroup.findOne({_id:req.params.id,members:req.user._id});if(!g)return res.status(403).json({error:'Not a group member.'});const m=await GroupMessage.findOne({_id:req.params.messageId,groupId:g._id,from:req.user._id});if(!m)return res.status(404).json({error:'Only your own message can be deleted.'});m.text='This message was deleted';m.deleted=true;await m.save();res.json({success:true});});
  app.post('/api/game/start',auth,async(req,res)=>{
    try{
      const game=String(req.body.game||'checkers');
      if(game!=='checkers')return res.status(400).json({error:'Invalid game.'});
      const now=new Date();
      await GameSession.deleteMany({userId:req.user._id,expiresAt:{$lte:now}});
      const token=crypto.randomBytes(32).toString('hex');
      await GameSession.create({userId:req.user._id,tokenHash:hash(token),game,startedAt:now,expiresAt:new Date(now.getTime()+15*60*1000)});
      res.json({token});
    }catch(e){console.error('[Game start]',e);res.status(500).json({error:'Could not start the game.'});}
  });
  app.post('/api/game/claim',auth,async(req,res)=>{
    try{
      const token=String(req.body.token||'');
      const game=String(req.body.game||'');
      const result=String(req.body.result||'');
      if(!token||game!=='checkers'||result!=='win')return res.status(400).json({error:'Invalid game result.'});
      const session=await GameSession.findOne({userId:req.user._id,tokenHash:hash(token),game:'checkers',claimedAt:null,expiresAt:{$gt:new Date()}});
      if(!session)return res.status(409).json({error:'Game session expired or reward already claimed.'});
      if(Date.now()-session.startedAt.getTime()<5000)return res.status(400).json({error:'Finish the game before claiming the reward.'});
      session.claimedAt=new Date();
      await session.save();
      const reward=50;
      const day=new Date().toISOString().slice(0,10);
      let u;
      if(isGameOwner(req.user)){
        u=await User.findByIdAndUpdate(req.user._id,{$inc:{coins:reward}},{new:true});
      }else{
        u=await User.findOneAndUpdate({_id:req.user._id,gameRewardDay:{$ne:day}},{$inc:{coins:reward},$set:{gameRewardDay:day}},{new:true});
        if(!u)return res.status(409).json({error:'Today’s game reward has already been claimed. Come back tomorrow.'});
      }
      await RewardLedger.create({userId:u._id,kind:'game-win',coins:reward,meta:{game:'checkers'}});await Notice.create({userId:u._id,kind:'coin',message:`Checkers victory reward: +${reward} coins`,data:{reward,game:'checkers'}});
      res.json({success:true,reward,user:cleanUser(u),owner:isGameOwner(u)});
    }catch(e){console.error('[Game claim]',e);res.status(500).json({error:'Could not add game reward.'});}
  });
  app.post('/api/admin/users/:id/hide',requireAdmin,async(req,res)=>{const hidden=!!req.body.hidden;const u=await User.findByIdAndUpdate(req.params.id,{$set:{hidden}},{new:true});if(!u)return res.status(404).json({error:'User not found.'});res.json({success:true,hidden});});
  app.post('/api/pair',auth,async(req,res)=>{
    let n=String(req.body.number||'').replace(/\D/g,'');
    if(n.startsWith('0'))n='94'+n.slice(1);
    if(!/^94\d{9}$/.test(n))return res.status(400).json({error:'Enter a valid Sri Lankan number.'});
    try{
      const now=new Date();
      let a=await PairAttempt.findOne({userId:req.user._id});
      if(a?.blockedUntil&&a.blockedUntil>now){
        const hours=Math.max(1,Math.ceil((a.blockedUntil-now)/3600000));
        return res.status(429).json({error:`You are blocked from getting pair codes for 24 hours. Try again in about ${hours} hour(s).`});
      }
      if(!a || (now-a.windowStartedAt)>=24*60*60*1000){
        a=await PairAttempt.findOneAndUpdate({userId:req.user._id},{$set:{count:1,windowStartedAt:now,blockedUntil:null}},{new:true,upsert:true,setDefaultsOnInsert:true});
      }else{
        if(a.count>=5){
          a.blockedUntil=new Date(now.getTime()+24*60*60*1000);
          await a.save();
          return res.status(429).json({error:'YOU ARE BLOCKED — pair code limit reached. Try again after 24 hours.'});
        }
        a.count+=1;
        await a.save();
      }
      const r=await requestPairCode(n);
      res.json({code:r.code,remaining:Math.max(0,5-a.count)});
    }catch(e){res.status(500).json({error:e.message||'Pairing failed'});}
  });
  app.post('/api/admin/login',async(req,res)=>{try{const identity=String(req.body.identity||req.body.email||req.body.username||'').trim().toLowerCase(),password=String(req.body.password||'');const expectedEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(),expectedUsername=String(process.env.ADMIN_USERNAME||'').trim().toLowerCase(),expectedPass=String(process.env.ADMIN_PASSWORD||'');const identityOk=!!identity&&((expectedEmail&&identity===expectedEmail)||(expectedUsername&&identity===expectedUsername));if(!expectedEmail||!expectedUsername||!expectedPass||!identityOk||password!==expectedPass)return res.status(401).json({error:'Invalid admin username/email or password. Check ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD in hosting environment variables.'});const t=crypto.randomBytes(32).toString('hex');await AdminSession.create({tokenHash:hash(t),expiresAt:new Date(Date.now()+8*3600000)});res.json({token:t});}catch(e){res.status(503).json({error:'Admin login unavailable. Check MongoDB connection.'});}});
  app.get('/api/admin/users',requireAdmin,async(req,res)=>{const users=await User.find({}).select('email username coins createdAt hidden').sort({createdAt:-1}).limit(500).lean();res.json({users});});
  app.post('/api/admin/coins',requireAdmin,async(req,res)=>{const target=String(req.body.target||'').trim().toLowerCase(),amount=Number(req.body.amount);if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)return res.status(400).json({error:'Invalid coin amount.'});const u=await User.findOneAndUpdate({$or:[{email:target},{username:target}]},{$inc:{coins:amount}},{new:true});if(!u)return res.status(404).json({error:'User not found.'});await RewardLedger.create({userId:u._id,kind:'admin-credit',coins:amount,meta:{from:'admin'}});await Notice.create({userId:u._id,kind:'coin',message:`Developer sent you ${amount} coins.`});res.json({user:cleanUser(u)});});
  app.get('/api/admin/config',requireAdmin,async(req,res)=>{const rows=await Config.find({}).lean();res.json({config:Object.fromEntries(rows.map(x=>[x.key,x.value]))});});
  // Admin HTML editor: store the complete user-dashboard.html in MongoDB so saves persist across redeploys.
  app.get('/api/admin/site-files/user-dashboard', requireAdmin, async (req, res) => {
    try {
      const saved = await Config.findOne({ key: 'userDashboardHtml' }).lean();
      const file = require('path').join(__dirname, 'public', 'user-dashboard.html');
      const html = typeof saved?.value === 'string' && saved.value.trim()
        ? saved.value : require('fs').readFileSync(file, 'utf8');
      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, html, source: saved?.value ? 'database' : 'file' });
    } catch (error) {
      console.error('[ZANTA] Could not load user dashboard HTML:', error);
      return res.status(500).json({ error: 'Could not load user-dashboard.html.' });
    }
  });
  app.put('/api/admin/site-files/user-dashboard', requireAdmin, async (req, res) => {
    try {
      const html = req.body && req.body.html;
      if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'Paste the user-dashboard.html content first.' });
      if (Buffer.byteLength(html, 'utf8') > 200 * 1024) return res.status(413).json({ error: 'HTML file is too large (maximum 200 KB).' });
      if (!/<html[\s>]/i.test(html) || !/<\/html\s*>/i.test(html)) return res.status(400).json({ error: 'Please paste a complete HTML document including <html> and </html>.' });
      await Config.findOneAndUpdate({ key: 'userDashboardHtml' }, { $set: { value: html } }, { upsert: true, new: true });
      res.set('Cache-Control', 'no-store');
      return res.json({ success: true, message: 'user-dashboard.html saved to MongoDB.' });
    } catch (error) {
      console.error('[ZANTA] Could not save user dashboard HTML:', error);
      return res.status(500).json({ error: 'Could not save user-dashboard.html. Check MongoDB connection.' });
    }
  });
  app.put('/api/admin/config/:key',requireAdmin,async(req,res)=>{const key=String(req.params.key);if(key==='apps'){const value=Array.isArray(req.body.value)?req.body.value:[];await Config.findOneAndUpdate({key},{$set:{value}},{upsert:true});return res.json({success:true});}if(key==='dashboardUI'){const value=req.body.value;if(!value||typeof value!=='object'||!Array.isArray(value.order)||!value.sizes||typeof value.sizes!=='object'||!value.text||typeof value.text!=='object')return res.status(400).json({error:'Dashboard config must include order, sizes and text.'});const allowed=['clock','hero','balance','tiles','rewards'];value.order=value.order.filter(x=>allowed.includes(String(x))).slice(0,5);for(const k of allowed){const n=Number(value.sizes[k]||12);value.sizes[k]=Math.max(3,Math.min(12,Number.isFinite(n)?Math.round(n):12));}for(const k of Object.keys(value.text))value.text[k]=String(value.text[k]||'').slice(0,160);await Config.findOneAndUpdate({key},{$set:{value}},{upsert:true});return res.json({success:true});}return res.status(400).json({error:'Unsupported setting.'});});
  app.post('/api/admin/apps',requireAdmin,async(req,res)=>{try{const name=String(req.body.name||'').trim().slice(0,60),url=String(req.body.url||'').trim(),price=Number(req.body.price);if(!name)return res.status(400).json({error:'App name is required.'});let parsed;try{parsed=new URL(url);}catch{return res.status(400).json({error:'Enter a valid app URL.'});}if(!['http:','https:'].includes(parsed.protocol))return res.status(400).json({error:'App URL must start with http:// or https://.'});if(!Number.isSafeInteger(price)||price<1||price>1000000)return res.status(400).json({error:'Coin amount must be between 1 and 1,000,000.'});const row=await Config.findOne({key:'apps'}).lean(),apps=Array.isArray(row?.value)?row.value:[];const id=crypto.randomBytes(8).toString('hex');apps.push({id,name,url:parsed.href,price});await Config.findOneAndUpdate({key:'apps'},{$set:{value:apps}},{upsert:true});res.status(201).json({success:true,apps});}catch(e){res.status(500).json({error:'Could not add app.'});}});
  app.post('/api/admin/apps/delete',requireAdmin,async(req,res)=>{try{const id=String(req.body.id||'');if(!id)return res.status(400).json({error:'App ID is required.'});const row=await Config.findOne({key:'apps'}).lean(),apps=Array.isArray(row?.value)?row.value:[],next=apps.filter(a=>String(a.id||a.name)!==id);if(next.length===apps.length)return res.status(404).json({error:'App not found.'});await Config.findOneAndUpdate({key:'apps'},{$set:{value:next}},{upsert:true});res.json({success:true,apps:next});}catch(e){res.status(500).json({error:'Could not delete app.'});}});
  app.post('/api/admin/message',requireAdmin,async(req,res)=>{const target=String(req.body.target||'').trim().toLowerCase(),message=String(req.body.message||'').trim().slice(0,1000);if(!message)return res.status(400).json({error:'Message required.'});const u=await User.findOne({$or:[{email:target},{username:target}]});if(!u)return res.status(404).json({error:'User not found.'});await Notice.create({userId:u._id,kind:'message',message});res.json({success:true});});

  app.get('/api/stats',async(req,res)=>{try{const [botCount,commandCount]=await Promise.all([mongoose.connection.db.collection('darkdinusessions').countDocuments({}),Promise.resolve(require('fs').readdirSync(commandsDir).filter(x=>x.endsWith('.js')).length)]);res.json({botCount,commandCount});}catch{res.status(503).json({error:'Stats unavailable'});}});
};
