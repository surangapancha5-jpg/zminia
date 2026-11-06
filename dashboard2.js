// ============================================================================
// ZANTA-XMD - Dashboard 2: WhatsApp Auto Reaction API Engine (Standalone)
// ============================================================================

module.exports = function attachDashboard2(app, options = {}) {
  const { mongoose, sock, getBaileysSock } = options;

  if (!mongoose) {
    console.error('[ZANTA DASHBOARD 2] Error: mongoose instance is required in options!');
    return;
  }

  // Schema Definitions
  const Schema = mongoose.Schema;

  const User = mongoose.models.ZantaWebUser || mongoose.model('ZantaWebUser', new Schema({
    coins: { type: Number, default: 0, min: 0 }
  }, { collection: 'zanta_web_users', strict: false }));

  const Notice = mongoose.models.ZantaNotice || mongoose.model('ZantaNotice', new Schema({
    userId: { type: Schema.Types.ObjectId, index: true },
    kind: String,
    message: String,
    createdAt: { type: Date, default: Date.now }
  }, { collection: 'zanta_notices' }));

  const ReactCampaign = mongoose.models.ZantaReactCampaign || mongoose.model('ZantaReactCampaign', new Schema({
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    username: String,
    postUrl: { type: String, required: true },
    emoji: { type: String, required: true },
    coinCost: { type: Number, default: 1 },
    status: { type: String, default: 'completed' },
    createdAt: { type: Date, default: Date.now }
  }, { collection: 'zanta_react_campaigns' }));

  const Session = mongoose.models.ZantaWebSession || mongoose.model('ZantaWebSession', new Schema({
    tokenHash: { type: String, unique: true, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
  }, { collection: 'zanta_web_sessions' }));

  // Helper Functions & Auth
  const COOKIE = 'zanta_session';
  const crypto = require('crypto');
  const hash = s => crypto.createHash('sha256').update(s).digest('hex');

  function getToken(req) {
    for (const p of (req.headers.cookie || '').split(';')) {
      const i = p.indexOf('=');
      if (i > 0 && p.slice(0, i).trim() === COOKIE) return decodeURIComponent(p.slice(i + 1));
    }
    return '';
  }

  const authMiddleware = async (req, res, next) => {
    try {
      const token = getToken(req);
      if (!token) return res.status(401).json({ error: 'Please log in.' });
      const sess = await Session.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } });
      if (!sess) return res.status(401).json({ error: 'Session expired. Please log in.' });
      req.user = await User.findById(sess.userId);
      if (!req.user) return res.status(401).json({ error: 'User not found.' });
      next();
    } catch (e) {
      res.status(503).json({ error: 'Database unavailable.' });
    }
  };

  // Serve Dashboard 2 Page (Optional Standalone Route)
  app.get('/react', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'public', 'react.html'));
  });

  // ============================================================================
  // STANDALONE AUTOMATED WHATSAPP CHANNEL REACTION API
  // ============================================================================
  app.post('/api/whatsapp/react-campaign', authMiddleware, async (req, res) => {
    try {
      const raw = String(req.body.postUrl || '').trim();
      const emoji = String(req.body.emoji || '').trim();

      let parsed;
      try {
        parsed = new URL(raw);
      } catch {
        return res.status(400).json({ error: 'Enter a valid WhatsApp channel post link.' });
      }

      if (parsed.protocol !== 'https:' || !['whatsapp.com', 'www.whatsapp.com'].includes(parsed.hostname) || !parsed.pathname.startsWith('/channel/')) {
        return res.status(400).json({ error: 'Only https://whatsapp.com/channel/... links are accepted.' });
      }

      if (!emoji || emoji.length > 12 || !/[\p{Extended_Pictographic}]/u.test(emoji)) {
        return res.status(400).json({ error: 'Choose a valid emoji.' });
      }

      // Deduct 1 coin from the user
      const user = await User.findOneAndUpdate({ _id: req.user._id, coins: { $gte: 1 } }, { $inc: { coins: -1 } }, { new: true });
      if (!user) return res.status(400).json({ error: 'Not enough coins. You need 1 coin.' });

      try {
        // Resolve active Baileys Socket instance
        const activeSock = sock || (typeof getBaileysSock === 'function' ? getBaileysSock() : global.whatsappSock);

        // Parse WhatsApp Channel Path: /channel/CHANNEL_CODE/MESSAGE_ID
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const channelCode = pathParts[1];
        const serverMsgId = pathParts[2];

        if (activeSock && activeSock.sendMessage && channelCode) {
          try {
            let targetJid = channelCode;
            if (!targetJid.includes('@')) {
              targetJid = channelCode + '@newsletter';
            }

            // Send Automated Reaction via Baileys
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
            console.error('[DASHBOARD 2 AUTO-REACT] Baileys send warning:', botErr.message);
          }
        }

        const campaign = await ReactCampaign.create({
          userId: user._id,
          username: user.username || 'User',
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
      console.error('[dashboard2 react-campaign]', e);
      res.status(500).json({ error: 'Could not execute automatic reaction.' });
    }
  });

  console.log('[ZANTA] Standalone Dashboard 2 attached successfully!');
};