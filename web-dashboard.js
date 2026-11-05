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
    coins:{type:Number,default:0,min:0}, unlockedApps:{type:[String],default:[]}, lastDaily:{type:String,default:''},
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
  const COOKIE='zanta_session', hash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const cleanUser=u=>({id:String(u._id),email:u.email,username:u.username,coins:u.coins,createdAt:u.createdAt});
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
  app.get('/',(req,res)=>res.sendFile(require('path').join(__dirname,'public','index.html')));
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
  app.get('/api/dashboard',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10);const notices=await Notice.find({$or:[{userId:req.user._id},{userId:null}]}).sort({createdAt:-1}).limit(30).lean();res.json({user:cleanUser(req.user),dailyAvailable:req.user.lastDaily!==day,notices,apps:await Config.findOne({key:'apps'}).lean().then(x=>(x?.value||[]).map(a=>({...a,unlocked:req.user.unlockedApps.includes(String(a.id||a.name))})))});});
  app.post('/api/daily',auth,async(req,res)=>{const day=new Date().toISOString().slice(0,10),rewards=[20,30,40,50,100,150],reward=rewards[Math.floor(Math.random()*rewards.length)];const u=await User.findOneAndUpdate({_id:req.user._id,lastDaily:{$ne:day}},{$inc:{coins:reward},$set:{lastDaily:day}},{new:true});if(!u)return res.status(409).json({error:'Daily reward already claimed.'});await Notice.create({userId:u._id,kind:'coin',message:`Daily reward: +${reward} coins`});res.json({reward,user:cleanUser(u)});});
  app.post('/api/apps/unlock',auth,async(req,res)=>{const id=String(req.body.id||'');const row=await Config.findOne({key:'apps'}).lean();const app=(row?.value||[]).find(a=>String(a.id||a.name)===id);if(!app)return res.status(404).json({error:'App not found.'});if(req.user.unlockedApps.includes(id))return res.json({success:true,alreadyUnlocked:true});const price=Math.max(200,Number(app.price)||200);const u=await User.findOneAndUpdate({_id:req.user._id,coins:{$gte:price}},{$inc:{coins:-price},$addToSet:{unlockedApps:id}},{new:true});if(!u)return res.status(400).json({error:'Not enough coins.'});await Notice.create({userId:u._id,kind:'app',message:`Unlocked ${app.name}`});res.json({success:true,user:cleanUser(u),url:app.url||''});});
  app.post('/api/pair',auth,async(req,res)=>{let n=String(req.body.number||'').replace(/\D/g,'');if(n.startsWith('0'))n='94'+n.slice(1);if(!/^94\d{9}$/.test(n))return res.status(400).json({error:'Enter a valid Sri Lankan number.'});try{const r=await requestPairCode(n);res.json({code:r.code});}catch(e){res.status(500).json({error:e.message||'Pairing failed'});}});
  app.post('/api/admin/login',async(req,res)=>{try{const identity=String(req.body.identity||req.body.email||req.body.username||'').trim().toLowerCase(),password=String(req.body.password||'');const expectedEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(),expectedUsername=String(process.env.ADMIN_USERNAME||'').trim().toLowerCase(),expectedPass=String(process.env.ADMIN_PASSWORD||'');const identityOk=!!identity&&((expectedEmail&&identity===expectedEmail)||(expectedUsername&&identity===expectedUsername));if(!expectedEmail||!expectedUsername||!expectedPass||!identityOk||password!==expectedPass)return res.status(401).json({error:'Invalid admin username/email or password. Check ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD in hosting environment variables.'});const t=crypto.randomBytes(32).toString('hex');await AdminSession.create({tokenHash:hash(t),expiresAt:new Date(Date.now()+8*3600000)});res.json({token:t});}catch(e){res.status(503).json({error:'Admin login unavailable. Check MongoDB connection.'});}});
  app.get('/api/admin/users',requireAdmin,async(req,res)=>{const users=await User.find({}).select('email username coins createdAt').sort({createdAt:-1}).limit(500).lean();res.json({users});});
  app.post('/api/admin/coins',requireAdmin,async(req,res)=>{const target=String(req.body.target||'').trim().toLowerCase(),amount=Number(req.body.amount);if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)return res.status(400).json({error:'Invalid coin amount.'});const u=await User.findOneAndUpdate({$or:[{email:target},{username:target}]},{$inc:{coins:amount}},{new:true});if(!u)return res.status(404).json({error:'User not found.'});await Notice.create({userId:u._id,kind:'coin',message:`Developer sent you ${amount} coins.`});res.json({user:cleanUser(u)});});
  app.get('/api/admin/config',requireAdmin,async(req,res)=>{const rows=await Config.find({}).lean();res.json({config:Object.fromEntries(rows.map(x=>[x.key,x.value]))});});
  app.put('/api/admin/config/:key',requireAdmin,async(req,res)=>{const key=String(req.params.key);if(!['apps','ai'].includes(key))return res.status(400).json({error:'Unsupported setting.'});let value=req.body.value;if(key==='ai'){const old=await Config.findOne({key:'ai'}).lean();const previous=old?.value||{};value={...previous,...(value||{})};if(!String(value.key||'').trim())value.key=previous.key||process.env.OPENROUTER_API_KEY||'';if(!String(value.endpoint||'').trim())value.endpoint=process.env.OPENROUTER_ENDPOINT||previous.endpoint||'https://openrouter.ai/api/v1/chat/completions';if(!String(value.model||'').trim())value.model=process.env.OPENROUTER_MODEL||previous.model||'meta-llama/llama-3.3-70b-instruct';}await Config.findOneAndUpdate({key},{$set:{value}},{upsert:true});res.json({success:true});});
  app.post('/api/admin/message',requireAdmin,async(req,res)=>{const target=String(req.body.target||'').trim().toLowerCase(),message=String(req.body.message||'').trim().slice(0,1000);if(!message)return res.status(400).json({error:'Message required.'});const u=await User.findOne({$or:[{email:target},{username:target}]});if(!u)return res.status(404).json({error:'User not found.'});await Notice.create({userId:u._id,kind:'message',message});res.json({success:true});});

  // ZANTA AI: keep credentials server-side and return actionable errors.
  app.post('/api/ai/chat', auth, async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database is not connected. Please try again shortly.' });
      }
      const row = await Config.findOne({ key: 'ai' }).lean();
      const cfg = row && row.value && typeof row.value === 'object' ? row.value : {};
      const endpoint = String(cfg.endpoint || process.env.OPENROUTER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions').trim();
      const apiKey = String(cfg.key || process.env.OPENROUTER_API_KEY || '').trim();
      const model = String(cfg.model || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct').trim();

      if (!apiKey || apiKey === 'your_new_openrouter_api_key') {
        return res.status(503).json({ error: 'ZANTA AI is not configured. Add a valid OPENROUTER_API_KEY in hosting environment variables or save the key in the owner AI settings.' });
      }
      if (!/^https:\/\//i.test(endpoint)) {
        return res.status(400).json({ error: 'Invalid AI endpoint. Use the HTTPS OpenRouter chat-completions endpoint.' });
      }
      if (!model) return res.status(400).json({ error: 'AI model is missing. Set OPENROUTER_MODEL or choose a model in the AI configuration.' });

      const incoming = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
      const messages = incoming
        .filter(m => m && ['user', 'assistant', 'system'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
      if (!messages.length || messages[messages.length - 1].role !== 'user') {
        return res.status(400).json({ error: 'Enter a message first.' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      let upstream;
      try {
        upstream = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': `${req.protocol}://${req.get('host')}`,
            'X-Title': 'ZANTA-XMD OFC'
          },
          body: JSON.stringify({ model, messages, temperature: 0.7 })
          , signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const raw = await upstream.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!upstream.ok) {
        const providerMessage = data && data.error && (data.error.message || data.error) || data.message;
        if (upstream.status === 401) return res.status(502).json({ error: 'OpenRouter rejected the API key (401). Check or replace OPENROUTER_API_KEY.' });
        if (upstream.status === 402) return res.status(502).json({ error: 'OpenRouter credits or billing are insufficient (402).' });
        if (upstream.status === 404) return res.status(502).json({ error: `OpenRouter model or endpoint not found (404). Check the model name: ${model}.` });
        if (upstream.status === 429) return res.status(502).json({ error: 'OpenRouter rate limit reached (429). Wait a little and try again.' });
        return res.status(502).json({ error: `OpenRouter error (${upstream.status}): ${String(providerMessage || 'No provider details returned').slice(0, 500)}` });
      }

      let reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (Array.isArray(reply)) reply = reply.map(part => typeof part === 'string' ? part : part && part.text || '').join('');
      if (typeof reply !== 'string' || !reply.trim()) {
        return res.status(502).json({ error: 'OpenRouter returned no text. Check whether the selected model supports chat completions.' });
      }
      return res.json({ reply: reply.trim() });
    } catch (e) {
      const timedOut = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
      console.error('[ZANTA AI] request failed:', e && e.message ? e.message : e);
      return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'ZANTA AI timed out after 45 seconds. Try again.' : 'Could not connect to OpenRouter. Check hosting network access and server logs.' });
    }
  });
  app.get('/api/stats',async(req,res)=>{try{const [botCount,commandCount]=await Promise.all([mongoose.connection.db.collection('darkdinusessions').countDocuments({}),Promise.resolve(require('fs').readdirSync(commandsDir).filter(x=>x.endsWith('.js')).length)]);res.json({botCount,commandCount});}catch{res.status(503).json({error:'Stats unavailable'});}});
};
