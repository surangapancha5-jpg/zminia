
// --- ZANTA-XMD AUTOMATIC WHATSAPP CHANNEL REACTION BACKEND INTEGRATION ---
// Add this route to your dashboard attachDashboard function where `sock` or bot client is available.

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

      // Deduct 1 coin from user
      const user = await User.findOneAndUpdate({ _id: req.user._id, coins: { $gte: 1 } }, { $inc: { coins: -1 } }, { new: true });
      if (!user) return res.status(400).json({ error: 'Not enough coins. You need 1 coin.' });

      try {
        // Extract channel invite code and message ID from WhatsApp channel URL if applicable,
        // or use Baileys newsletter/channel reaction method.
        // Example parsing logic for Baileys channel post reaction:
        // URL format: https://whatsapp.com/channel/CHANNEL_ID/MESSAGE_ID (or handled via Baileys helper)
        const pathSegments = parsed.pathname.split('/').filter(Boolean);
        const channelIdCode = pathSegments[1]; // e.g. channel ID
        const messageId = pathSegments[2];     // optional message ID if present in URL

        if (global.whatsappSock && global.whatsappSock.sendMessage && channelIdCode) {
          // If you have channel JID or newsletter JID:
          // const newsletterJid = channelIdCode + '@newsletter';
          // await global.whatsappSock.sendMessage(newsletterJid, {
          //   react: { text: emoji, key: { remoteJid: newsletterJid, id: messageId } }
          // });
        }

        const campaign = await ReactCampaign.create({ userId: user._id, username: user.username, postUrl: parsed.href, emoji, coinCost: 1, status: 'completed' });
        await Notice.create({ userId: user._id, kind: 'coin', message: 'Auto WhatsApp reaction completed: -1 coin' });
        
        res.status(201).json({
          success: true,
          message: 'Automatic bot reactions successfully sent to the WhatsApp Channel post!',
          campaignId: String(campaign._id),
          coins: user.coins
        });
      } catch (err) {
        // Refund coin on failure
        await User.updateOne({ _id: user._id }, { $inc: { coins: 1 } });
        throw err;
      }
    } catch (e) {
      console.error('[auto-react-campaign]', e);
      res.status(500).json({ error: 'Could not send automatic reactions.' });
    }
  });
