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
    passwordHash:{type:String,required:true}, passwordSalt:{type:String,required:true},
    coins:{type:Number,default:0,min:0}, taskClaims:{type:[String],default:[]}, unlockedApps:{type:[String],default:[]}, lastDaily:{type:String,default:''},
    createdAt:{type:Date,default:Date.now}
  },{collection:'zanta_web_users'}));
  const Session = mongoose.models.ZantaWebSession || mongoose.model('ZantaWebSession',new Schema({
    tokenHash:{type:String,unique:true,required:true},userId:{type:Schema.Types.ObjectId,required:true,index:true},
    expiresAt:{type:Date,required:true,index:{expires:0}}
  },{collection:'zanta_web_sessions'}));
  const AdminSession = mongoose.models.ZantaAdminSession || mongoose.model('ZantaAdminSession',new Schema({tokenHash:{type:String,unique:true},expiresAt:{type:Date,index:{expires:0}}},{collection:'zanta_admin_sessions'}));
  const Notice = mongoose.models.ZantaNotice || mongoose.model('ZantaNotice',new Schema({
    userId:{type:Schema.Types.ObjectId,index:true},kind:String,message:String,createdAt:{type:Date,default:Date.now},read:{type:Boolean,default:false}
  },{collection:'zanta_notices'}));
  const Config = mongoose.models.ZantaConfig || mongoose.model('ZantaConfig',new Schema({key:{type:String,unique:true},value:Schema.Types.Mixed},{collection:'zanta_config'}));
  const SupportTicket = mongoose.models.ZantaSupportTicket || mongoose.model('ZantaSupportTicket',new Schema({userId:{type:Schema.Types.ObjectId,index:true},username:String,email:String,subject:{type:String,default:'Support request'},message:{type:String,required:true,maxlength:2000},createdAt:{type:Date,default:Date.now},status:{type:String,default:'open'}},{collection:'zanta_support_tickets'}));
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
  app.get('/',(req,res)=>res.sendFile(require('path').join(__dirname,'public','loading.html')));
  app.get('/home',(req,res)=>res.sendFile(require('path').join(__dirname,'public','index.html')));
  app.get('/loading.html',(req,res)=>res.sendFile(require('path').join(__dirname,'public','loading.html')));
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
  app.get('/zanta-owner-console-7f3a',(req,res)=>res.sendFile(require('path').join(__dirname,'public','index.html')));
  app.get('/api/auth/me',async(req,res)=>{try{const u=await current(req);res.json({authenticated:!!u,user:u?cleanUser(u):null});}catch{res.status(503).json({error:'Database unavailable'});}});
  app.post('/api/auth/register',async(req,res)=>{try{
    const email=String(req.body.email||'').trim().toLowerCase(), username=String(req.body.username||'').trim().toLowerCase(), p=req.body.password;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
    if(!usernameOk(username))return res.status(400).json({error:'Username must start with @ and contain 4–21 characters.'});
    // The configured owner account may use its exact server-side credentials;
    // normal registrations must still satisfy the password-strength policy.
    const isConfiguredOwner = email === String(process.env.ADMIN_EMAIL||'').trim().toLowerCase()
      && username === String(process.env.ADMIN_USERNAME||'').trim().toLowerCase()
      && String(p||'') === String(process.env.ADMIN_PASSWORD||'');
    if(!isConfiguredOwner && !validPass(p))return res.status(400).json({error:'Password must be 9–19 characters, include letters and numbers, and avoid simple sequences.'});
    if(await User.exists({$or:[{email},{username}]}))return res.status(409).json({error:'Email or username already registered.'});
    const salt=crypto.randomBytes(16).toString('hex'),passwordHash=await passHash(p,salt);
    const u=await User.create({email,username,passwordHash,passwordSalt:salt});await session(res,req,u);res.status(201).json({user:cleanUser(u)});
  }catch(e){res.status(500).json({error:'Registration failed.'});}});
  app.post('/api/auth/login',async(req,res)=>{try{const id=String(req.body.identity||'').trim().toLowerCase(),p=String(req.body.password||'');const u=await User.findOne({$or:[{email:id},{username:id}]});if(!u||!crypto.timingSafeEqual(Buffer.from(await passHash(p,u.passwordSalt),'hex'),Buffer.from(u.passwordHash,'hex')))return res.status(401).json({error:'Invalid login details.'});await session(res,req,u);res.json({user:cleanUser(u)});}catch{res.status(500).json({error:'Login failed.'});}});
  app.post('/api/auth/logout',async(req,res)=>{const t=token(req);if(t)await Session.deleteOne({tokenHash:hash(t)});res.setHeader('Set-Cookie',cookie(req,0));res.json({success:true});});
  app.get('/api/dashboard',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10);const notices=await Notice.find({$or:[{userId:req.user._id},{userId:null}]}).sort({createdAt:-1}).limit(30).lean();const [appsRow,uiRow]=await Promise.all([Config.findOne({key:'apps'}).lean(),Config.findOne({key:'dashboardUI'}).lean()]);res.json({user:cleanUser(req.user),dailyAvailable:req.user.lastDaily!==day,notices, dashboardUI:uiRow?.value||{},apps:(appsRow?.value||[]).map(a=>({...a,unlocked:req.user.unlockedApps.includes(String(a.id||a.name))}))});});
  app.post('/api/rewards/claim',auth,async(req,res)=>{try{const task=String(req.body.task||'');if(!['youtube','whatsapp'].includes(task))return res.status(400).json({error:'Invalid reward task.'});const reward=50;const u=await User.findOneAndUpdate({_id:req.user._id,taskClaims:{$ne:task}},{$inc:{coins:reward},$addToSet:{taskClaims:task}},{new:true});if(!u)return res.status(409).json({error:'This reward has already been claimed.'});await Notice.create({userId:u._id,kind:'coin',message:`${task==='youtube'?'YouTube subscribe':'WhatsApp Channel follow'} reward: +${reward} coins`});res.json({success:true,reward,user:cleanUser(u)});}catch(e){res.status(500).json({error:'Could not claim reward.'});}});
  app.post('/api/daily',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10),rewards=[20,30,40,50,100,150],reward=rewards[Math.floor(Math.random()*rewards.length)];const u=await User.findOneAndUpdate({_id:req.user._id,lastDaily:{$ne:day}},{$inc:{coins:reward},$set:{lastDaily:day}},{new:true});if(!u)return res.status(409).json({error:'Daily reward already claimed.'});await Notice.create({userId:u._id,kind:'coin',message:`Daily reward: +${reward} coins`});res.json({reward,user:cleanUser(u)});});
  app.post('/api/apps/unlock',auth,async(req,res)=>{const id=String(req.body.id||'');const row=await Config.findOne({key:'apps'}).lean();const app=(row?.value||[]).find(a=>String(a.id||a.name)===id);if(!app)return res.status(404).json({error:'App not found.'});if(req.user.unlockedApps.includes(id))return res.json({success:true,alreadyUnlocked:true});const price=Math.max(1,Number(app.price)||200);const u=await User.findOneAndUpdate({_id:req.user._id,coins:{$gte:price}},{$inc:{coins:-price},$addToSet:{unlockedApps:id}},{new:true});if(!u)return res.status(400).json({error:'Not enough coins.'});await Notice.create({userId:u._id,kind:'app',message:`Unlocked ${app.name}`});res.json({success:true,user:cleanUser(u),url:app.url||''});});
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
  app.post('/api/pair',auth,async(req,res)=>{let n=String(req.body.number||'').replace(/\D/g,'');if(n.startsWith('0'))n='94'+n.slice(1);if(!/^94\d{9}$/.test(n))return res.status(400).json({error:'Enter a valid Sri Lankan number.'});try{const r=await requestPairCode(n);res.json({code:r.code});}catch(e){res.status(500).json({error:e.message||'Pairing failed'});}});
  app.post('/api/admin/login',async(req,res)=>{try{const identity=String(req.body.identity||req.body.email||req.body.username||'').trim().toLowerCase(),password=String(req.body.password||'');const expectedEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(),expectedUsername=String(process.env.ADMIN_USERNAME||'').trim().toLowerCase(),expectedPass=String(process.env.ADMIN_PASSWORD||'');const identityOk=!!identity&&((expectedEmail&&identity===expectedEmail)||(expectedUsername&&identity===expectedUsername));if(!expectedEmail||!expectedUsername||!expectedPass||!identityOk||password!==expectedPass)return res.status(401).json({error:'Invalid admin username/email or password. Check ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD in hosting environment variables.'});const t=crypto.randomBytes(32).toString('hex');await AdminSession.create({tokenHash:hash(t),expiresAt:new Date(Date.now()+8*3600000)});res.json({token:t});}catch(e){res.status(503).json({error:'Admin login unavailable. Check MongoDB connection.'});}});
  app.get('/api/admin/users',requireAdmin,async(req,res)=>{const users=await User.find({}).select('email username coins createdAt').sort({createdAt:-1}).limit(500).lean();res.json({users});});
  app.post('/api/admin/coins',requireAdmin,async(req,res)=>{const target=String(req.body.target||'').trim().toLowerCase(),amount=Number(req.body.amount);if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)return res.status(400).json({error:'Invalid coin amount.'});const u=await User.findOneAndUpdate({$or:[{email:target},{username:target}]},{$inc:{coins:amount}},{new:true});if(!u)return res.status(404).json({error:'User not found.'});await Notice.create({userId:u._id,kind:'coin',message:`Developer sent you ${amount} coins.`});res.json({user:cleanUser(u)});});
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
