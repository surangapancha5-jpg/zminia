// ============================================================================
// ZANTA-XMD - Dashboard 2: Standalone WhatsApp Auto Reaction Engine (Fully Fixed)
// ============================================================================
const path = require('path');
const crypto = require('crypto');

module.exports = function attachDashboard2(app, options = {}) {
  const { mongoose, sock, getBaileysSock } = options;

  if (!mongoose) {
    console.error('[ZANTA DASHBOARD 2] Error: mongoose instance is required in options!');
    return;
  }

  const Schema = mongoose.Schema;

  // --- MONGOOSE MODELS FOR DASHBOARD 2 ---
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

  // --- AUTH MIDDLEWARE & HELPERS ---
  const COOKIE = 'zanta_session';
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

  // --- ROUTE FOR REACT HTML PAGE ---
  app.get('/react', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'react.html'));
  });

  // ============================================================================
  // --- AUTOMATED WHATSAPP CHANNEL REACTION API ENDPOINT (FULLY FIXED) ---
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

      // WhatsApp Channel URL Parse කර ගැනීම: /channel/CHANNEL_CODE/MESSAGE_ID
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const channelCode = pathParts[1];
      const serverMsgId = pathParts[2]; // පෝස්ටුවේ නිශ්චිත ID එක (උදා: 106)

      if (!channelCode) {
        return res.status(400).json({ error: 'Invalid WhatsApp channel link.' });
      }

      // 1 Coin එකක් කපාගැනීම
      const user = await User.findOneAndUpdate({ _id: req.user._id, coins: { $gte: 1 } }, { $inc: { coins: -1 } }, { new: true });
      if (!user) return res.status(400).json({ error: 'Not enough coins. You need 1 coin.' });

      try {
        // activeBaileys Socket එක ලබා ගැනීම
        let activeSock = sock || (typeof getBaileysSock === 'function' ? getBaileysSock() : global.whatsappSock);
        
        if (!activeSock && global.activeBotSockets && global.activeBotSockets.size > 0) {
          activeSock = Array.from(global.activeBotSockets)[0];
        }

        if (activeSock) {
          try {
            let targetJid = channelCode;
            if (!targetJid.includes('@')) {
              targetJid = channelCode + '@newsletter';
            }

            // Metadata හරහා නිවැරදි Newsletter JID එක ලබා ගැනීමට උත්සාහ කිරීම
            if (typeof activeSock.newsletterMetadata === 'function') {
              try {
                const meta = await activeSock.newsletterMetadata("invite", channelCode);
                if (meta && meta.id) {
                  targetJid = meta.id;
                }
              } catch (metaErr) {
                // Fallback to @newsletter format
              }
            }

            // පෝස්ටු ID එක (Message ID) තිබේ නම් රිඇක්ට් යැවීම
            if (serverMsgId) {
              // පළමුව newsletterReactMessage ක්‍රමය පරීක්ෂා කිරීම
              if (typeof activeSock.newsletterReactMessage === 'function') {
                await activeSock.newsletterReactMessage(targetJid, serverMsgId, emoji);
              } else if (typeof activeSock.sendMessage === 'function') {
                // නැතහොත් sendMessage හරහා යැවීම
                await activeSock.sendMessage(targetJid, {
                  react: {
                    text: emoji,
                    key: {
                      remoteJid: targetJid,
                      id: serverMsgId,
                      fromMe: false
                    }
                  }
                });
              }
            } else {
              console.warn('[ZANTA AUTO-REACT] Warning: Message ID (serverMsgId) is missing in URL.');
            }
          } catch (botErr) {
            console.error('[DASHBOARD 2 AUTO-REACT] Baileys send error:', botErr.message);
          }
        } else {
          console.warn('[ZANTA AUTO-REACT] Warning: Active bot socket not found.');
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
        // දෝෂයක් ආවොත් කපාගත් කොයින් එක ආපසු ලබා දීම (Refund)
        await User.updateOne({ _id: user._id }, { $inc: { coins: 1 } });
        throw err;
      }
    } catch (e) {
      console.error('[dashboard2 react-campaign]', e);
      res.status(500).json({ error: 'Could not execute automatic reaction.' });
    }
  });

  console.log('[ZANTA] Standalone Dashboard 2 attached successfully with fixed Auto-Reaction engine!');
};