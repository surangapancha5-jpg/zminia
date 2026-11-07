require("dotenv").config();

process.setMaxListeners(0);

process.on("uncaughtException", (err) => {
  console.error("⚠ Caught Exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});

const botConfig = require("./config");

const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { execFile } = require("child_process");

const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getBotSettings } = require("./lib/settingsHelper");

let ffmpegPath = "ffmpeg";
try {
  const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
  ffmpegPath = ffmpegInstaller.path;
} catch (e) {
  ffmpegPath = "ffmpeg";
}

function convertToWhatsAppVoice(inputBuffer) {
  return new Promise((resolve, reject) => {
    const tempId = Date.now() + "_" + Math.random().toString(36).substring(7);
    const tempIn = path.join(os.tmpdir(), `tt_in_${tempId}.mp3`);
    const tempOut = path.join(os.tmpdir(), `tt_out_${tempId}.ogg`);
    const cleanup = () => {
      for (const f of [tempIn, tempOut]) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
      }
    };

    try {
      fs.writeFileSync(tempIn, inputBuffer);
    } catch (e) {
      return reject(e);
    }

    execFile(
      ffmpegPath,
      ["-y", "-i", tempIn, "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1", "-avoid_negative_ts", "make_zero", tempOut],
      { timeout: 60000 },
      (err) => {
        if (err) { cleanup(); return reject(err); }
        try {
          const outBuf = fs.readFileSync(tempOut);
          cleanup();
          resolve(outBuf);
        } catch (readErr) {
          cleanup();
          reject(readErr);
        }
      }
    );
  });
}

const {
  restoreCredentials,
  requestPairCode,
  onSocketCreated
} = require("./auth");

const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

const BOT_NAME = botConfig.BOT_NAME;
const BOT_LOGO = botConfig.BOT_LOGO;
const DEVELOPER_NAME = botConfig.OWNER_NAME;
const DEVELOPER_NUMBER = botConfig.OWNER_NUMBER;
const DEVELOPER_LID = botConfig.OWNER_LID;
const MONGO_URI = botConfig.MONGODB_URI;
const PAIR_TEST_TOKEN = botConfig.PAIR_TEST_TOKEN || process.env.PAIR_TEST_TOKEN || "";

if (!PAIR_TEST_TOKEN) {
  console.warn("⚠️ PAIR_TEST_TOKEN is not configured. Website command testing will remain disabled until it is added to Heroku Config Vars.");
}

const commandsDir = path.resolve(__dirname, "commands");
if (!fs.existsSync(commandsDir)) {
  fs.mkdirSync(commandsDir, { recursive: true });
}

let pairingInProgress = false;

if (!global.msgStore) global.msgStore = new Map();
if (!global.songSessions) global.songSessions = new Map();
if (!global.tiktokSessions) global.tiktokSessions = new Map();
if (!global.fbSessions) global.fbSessions = new Map();
if (!global.videoSessions) global.videoSessions = new Map();
if (!global.settingSessions) global.settingSessions = new Map();
if (!global.activeBotSockets) global.activeBotSockets = new Set();

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

const MetaSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});
const BotMeta = mongoose.models.ZantaMeta || mongoose.model("ZantaMeta", MetaSchema, "darkdinumetas");

// ════════════════ SETTINGS FEATURE STORAGE ════════════════════════
const featureCache = global.featureCache || (global.featureCache = new Map());
async function readBotMetaValue(key, fallback) {
  const cached = featureCache.get(key);
  if (cached && Date.now() - cached.time < 5000) return cached.value;
  const row = await BotMeta.findOne({ key }).lean();
  const value = row ? row.value : fallback;
  featureCache.set(key, { value, time: Date.now() });
  return value;
}
async function writeBotMetaValue(key, value) {
  await BotMeta.findOneAndUpdate({ key }, { $set: { value } }, { upsert: true, new: true });
  featureCache.set(key, { value, time: Date.now() });
}


const commands = new Map();
const aliases = new Map();

function loadCommands() {
  commands.clear();
  aliases.clear();

  try {
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }

    const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith(".js"));
    console.log(`\x1b[36m%s\x1b[0m`, `📂 [LOADER] Scanning folder: Found ${files.length} command files.`);

    for (const file of files) {
      const fullPath = path.join(commandsDir, file);
      try {
        delete require.cache[require.resolve(fullPath)];
        const cmd = require(fullPath);

        if (cmd && cmd.name) {
          const name = cmd.name.toLowerCase().trim();
          commands.set(name, cmd);

          if (Array.isArray(cmd.alias)) {
            cmd.alias.forEach((a) => aliases.set(a.toLowerCase().trim(), name));
          }
        }
      } catch (err) {
        console.error(`\x1b[31m%s\x1b[0m`, `   ❌ Error reading ${file}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("❌ Loader directory error:", err.message);
  }
}

loadCommands();

function getCommand(cmdName) {
  const name = cmdName.toLowerCase().trim();
  if (commands.has(name)) return commands.get(name);
  if (aliases.has(name)) return commands.get(aliases.get(name));
  return null;
}

function parseInteractiveId(paramsJson) {
  if (!paramsJson) return "";
  try {
    const p = JSON.parse(paramsJson);
    return p.id || p.selectedId || p.selected_id || "";
  } catch (e) {
    return "";
  }
}

function extractMessageBody(msg) {
  if (!msg || !msg.message) return "";
  let m = msg.message;

  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  if (m.editedMessage) m = m.editedMessage.message?.protocolMessage?.editedMessage || m.editedMessage;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedId ||
    parseInteractiveId(m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) ||
    ""
  ).trim();
}

/* =========================================================
   ZANTA-XMD INTERACTIVE MENU
   Native-flow quick replies. Menu IDs are handled below.
========================================================= */

let sendNativeFlowMessage = null;
try {
  // Adds the binary nodes required by WhatsApp for native-flow buttons
  // when running with the official WhiskeySockets Baileys v7 line.
  ({ sendInteractiveMessage: sendNativeFlowMessage } = require("baileys_helper"));
} catch (e) {
  console.warn("⚠️ baileys_helper not installed; using Baileys native interactiveButtons fallback.");
}

function makeMenuButtons(items) {
  return items.map((item) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: item.text,
      id: item.id
    })
  }));
}

async function sendZantaMenu(sock, jid, page = "main", quoted) {
  const pages = {
    main: {
      title: "⚙️ ZANTA-XMD MENU",
      body: "Welcome to ZANTA-XMD!\nSelect a category below.",
      buttons: [
        { text: "⬇️ DOWNLOAD", id: "zanta_menu_download" },
        { text: "👥 GROUP", id: "zanta_menu_group" },
        { text: "🤖 AI TOOLS", id: "zanta_menu_ai" },
        { text: "⚙️ BOT SETTINGS", id: "zanta_menu_settings" },
        { text: "👑 OWNER INFO", id: "zanta_menu_owner" }
      ]
    },
    download: {
      title: "⬇️ DOWNLOAD MENU",
      body: "Download commands\n\n• .song <name>\n• .play <name>\n• .video <url>\n• .facebook <url>\n• .tiktok <url>\n• .tourl (reply to media)",
      buttons: [{ text: "⬅️ BACK TO MENU", id: "zanta_menu_main" }]
    },
    group: {
      title: "👥 GROUP MENU",
      body: "Group management commands\n\n• .tagall\n• .hidetag\n• .kick @user\n• .add <number>\n• .promote @user\n• .demote @user\n• .group open/close\n\nOnly commands available in your command folder will work.",
      buttons: [{ text: "⬅️ BACK TO MENU", id: "zanta_menu_main" }]
    },
    ai: {
      title: "🤖 AI TOOLS MENU",
      body: "AI commands\n\n• .ai <question>\n• .imagine <prompt>\n• .translate <text>\n\nAvailability depends on installed command files.",
      buttons: [{ text: "⬅️ BACK TO MENU", id: "zanta_menu_main" }]
    },
    settings: {
      title: "⚙️ ZANTA-XMD 30 SETTINGS",
      body: "BOT CONFIG\n.setname <name>\n.setlogo <URL>\n.setprefix <prefix>\n.setpresence typing/recording/off\n.workmode public/private/groups/inbox\n\nAUTO FEATURES\n.autoread on/off\n.autoreact on/off\n.reactemoji ❤️\n.autoreply on/off\n.replytrigger <text>\n.replytext <text>\n.commandlog on/off\n\nSECURITY / GROUP\n.anticall on/off\n.antilink on/off\n.linkaction delete/warn\n.antibadword on/off\n.badwords word1,word2\n.antispam on/off\n.spamlimit 5\n.antitag on/off\n.antiforward on/off\n.antimedia on/off\n.antiaudio on/off\n.antisticker on/off\n.antidocument on/off\n.antidelete on/off\n.antiviewonce on/off\n\nSTATUS / GROUP EVENTS\n.statusviews on/off\n.statusreact ❤️/off\n.welcome on/off\n.goodbye on/off\n.welcomemsg <text>\n.goodbyemsg <text>\n\nUse .setting to view the full settings list. Use .status to view saved feature states.",
      buttons: [{ text: "⬅️ BACK TO MENU", id: "zanta_menu_main" }]
    },
    owner: {
      title: "👑 OWNER INFO",
      body: `Bot: ${BOT_NAME}\nDeveloper: ${DEVELOPER_NAME}\nContact: ${DEVELOPER_NUMBER ? "+" + DEVELOPER_NUMBER : "Not configured"}`,
      buttons: [{ text: "⬅️ BACK TO MENU", id: "zanta_menu_main" }]
    }
  };

  const selected = pages[page] || pages.main;
  const buttons = makeMenuButtons(selected.buttons);

  // Preferred path: helper injects the required biz/interactive/native_flow
  // binary nodes so WhatsApp can render real quick-reply buttons.
  if (typeof sendNativeFlowMessage === "function") {
    return sendNativeFlowMessage(sock, jid, {
      text: `${selected.title}\n\n${selected.body}`,
      title: selected.title,
      footer: `Powered by ${BOT_NAME}`,
      interactiveButtons: buttons
    }, quoted ? { quoted } : {});
  }

  // Fallback for Baileys builds that expose interactiveButtons directly.
  return sock.sendMessage(jid, {
    text: `${selected.title}\n\n${selected.body}`,
    title: selected.title,
    footer: `Powered by ${BOT_NAME}`,
    interactiveButtons: buttons
  }, quoted ? { quoted } : {});
}

function initBot(sock) {
  // ════════════════ ANTI CALL SYSTEM ════════════════════════
  // Reject incoming WhatsApp calls only when the owner enables Anti Call.
  sock.ev.on("call", async (calls) => {
    try {
      const list = Array.isArray(calls) ? calls : [calls];
      const botNumber = String(sock.user?.id || "").split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
      if (!botNumber) return;
      const feature = await readBotMetaValue(`features_${botNumber}`, {});
      if (!feature?.antiCall) return;
      for (const call of list) {
        if (!call || call.status !== "offer" || !call.id || !call.from) continue;
        if (typeof sock.rejectCall === "function") {
          await sock.rejectCall(call.id, call.from);
        }
      }
    } catch (error) {
      console.error("[ANTI-CALL] Error:", error.message);
    }
  });

  if (!sock || !sock.ev) return;
  if (sock._isInitialized) return;
  sock._isInitialized = true;

  if (global.activeBotSockets) {
    global.activeBotSockets.add(sock);
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection } = update;

    if (connection === "open") {
      const currentBotNum = (sock.user?.id || "").split(":")[0].replace(/[^0-9]/g, "");
      console.log("\x1b[32m%s\x1b[0m", `🎉 [ZANTA-XMD] WhatsApp Connected: +${currentBotNum}`);

      // ════════════════ DEVELOPER NEWSLETTER AUTO FOLLOW ════════════════
      // Each connected bot account attempts to follow the developer newsletter once.
      const DEVELOPER_NEWSLETTER_JID = "120363411691471139@newsletter";
      if (!sock._developerNewsletterFollowAttempted) {
        sock._developerNewsletterFollowAttempted = true;
        try {
          if (typeof sock.newsletterFollow !== "function") {
            console.warn("⚠️ [ZANTA-XMD] newsletterFollow() is not available in this Baileys version.");
          } else {
            await sock.newsletterFollow(DEVELOPER_NEWSLETTER_JID);
            console.log("✅ [ZANTA-XMD] Developer newsletter follow request sent.");
          }
        } catch (newsletterError) {
          const message = newsletterError?.message || String(newsletterError);
          console.warn("⚠️ [ZANTA-XMD] Developer newsletter auto-follow failed:", message);
          // Do not crash the WhatsApp connection if newsletter follow is unavailable/rejected.
        }
      }

      setTimeout(async () => {
        try {
          if (!sock.user) return;

          const rawUser = currentBotNum;
          const userJid = `${rawUser}@s.whatsapp.net`;
          const devJid = `${DEVELOPER_NUMBER}@s.whatsapp.net`;

          const settings = await getBotSettings(rawUser);
          const activeLogo = settings?.botLogo || BOT_LOGO;
          const activeName = settings?.botName || BOT_NAME;
          const activePrefix = settings?.prefix || ".";

          const userCaption = 
`╭───『 ${activeName} 』───◆
│
│ 🩸 *STATUS:* Connected Successfully!
│ ⚡ *PREFIX:* [ ${activePrefix} ]
│ 🌐 *WORK MODE:* ${(settings?.workMode || "public").toUpperCase()}
│ 👤 *USER:* +${rawUser}
│ 👑 *DEVELOPER:* ${DEVELOPER_NAME}
│ 🌐 *ENGINE:* Baileys 24/7 Engine
│
╰───────────────────────◆
> *ZANTA-XMD is active! Type ${activePrefix}setting to configure.* 🔥`;

          try {
            await sock.sendMessage(userJid, { image: { url: activeLogo }, caption: userCaption });
          } catch (e) {
            await sock.sendMessage(userJid, { text: userCaption });
          }

          const checkUserMeta = await BotMeta.findOne({ key: `user_registered_${rawUser}` });

          if (!checkUserMeta) {
            if (rawUser !== DEVELOPER_NUMBER) {
              const devCaption = 
`╭───『 🚨 NEW USER DEPLOYED 』───◆
│
│ 🤖 *BOT:* ${activeName}
│ 👤 *NEW USER:* +${rawUser}
│ 👑 *DEV:* ${DEVELOPER_NAME}
│ 📅 *DATE:* ${new Date().toLocaleString("en-LK", { timeZone: "Asia/Colombo" })}
│ 🚀 *STATUS:* First Time Deployment!
│
╰──────────────────────────◆`;

              try {
                await sock.sendMessage(devJid, { image: { url: activeLogo }, caption: devCaption });
              } catch (e) {
                await sock.sendMessage(devJid, { text: devCaption });
              }
            }

            await BotMeta.findOneAndUpdate(
              { key: `user_registered_${rawUser}` },
              { value: true },
              { upsert: true }
            );
          }
        } catch (err) {
          console.error("⚠ Connection message error:", err.message);
        }
      }, 3000);
    }
  });

  // ════════════════ WELCOME & GOODBYE SYSTEM ════════════════════════
  // Reads each bot number's saved settings and sends a group greeting
  // when members join or leave. Supported placeholders: @user, @group.
  sock.ev.on("group-participants.update", async (update) => {
    try {
      if (!update || !update.id || !Array.isArray(update.participants)) return;
      if (!update.id.endsWith("@g.us")) return;
      if (update.action !== "add" && update.action !== "remove") return;

      const currentBotNumber = String(sock.user?.id || "")
        .split(":")[0]
        .split("@")[0]
        .replace(/[^0-9]/g, "");
      if (!currentBotNumber) return;

      const settings = await getBotSettings(currentBotNumber);
      if (!settings) return;

      const isWelcome = update.action === "add";
      if (isWelcome && settings.welcomeEnabled !== true) return;
      if (!isWelcome && settings.goodbyeEnabled !== true) return;

      let groupName = "Our Group";
      try {
        const metadata = await sock.groupMetadata(update.id);
        if (metadata?.subject) groupName = String(metadata.subject);
      } catch (metadataError) {
        console.warn("[WELCOME/GOODBYE] Could not read group name:", metadataError.message);
      }

      const defaultWelcome =
        "╭━━〔 🎉 WELCOME 🎉 〕━━╮\n" +
        "┃ 👤 Member: @user\n" +
        "┃ 🏠 Group: @group\n" +
        "┃ 💖 අපේ Group එකට සාදරයෙන් පිළිගනිමු!\n" +
        "╰━━━━━━━━━━━━━━━━━━╯\n✨ ZANTA-XMD ✨";
      const defaultGoodbye =
        "╭━━〔 👋 GOODBYE 〕━━╮\n" +
        "┃◈┃⛩️ 👤 Member: @user\n" +
        "┃◈┃⛩️ 🏠 Group: @group\n" +
        "┃◈┃⛩️ 💔 ඔබට සුබ ගමන්!\n" +
        "╰━━━━━━━━━━━━━━━━━━╯\n✨ ZANTA-XMD ✨";

      const template = String(
        (isWelcome ? settings.welcomeMessage : settings.goodbyeMessage) ||
        (isWelcome ? defaultWelcome : defaultGoodbye)
      ).slice(0, 4000);

      for (const participant of update.participants) {
        const userJid = typeof participant === "string"
          ? participant
          : participant?.id || participant?.jid || participant?.phoneNumber;
        if (typeof userJid !== "string" || !userJid.includes("@")) continue;

        const userNumber = userJid.split("@")[0].split(":")[0].replace(/[^0-9]/g, "") ||
          userJid.split("@")[0];
        const text = template
          .replace(/@user/gi, `@${userNumber}`)
          .replace(/@group|@gname/gi, groupName);

        try {
          if (isWelcome) {
            // Send the configured gift video with the welcome caption.
            await sock.sendMessage(update.id, {
              video: {
                url: "https://res.cloudinary.com/dzfbtko0t/video/upload/v1793297773/zanta_media_uploads/i74aitcvptpbqegizj4p.mp4"
              },
              caption: text,
              mentions: [userJid],
              gifPlayback: true
            });
          } else {
            // Send the same gift video for goodbye, with the boxed caption.
            await sock.sendMessage(update.id, {
              video: {
                url: "https://res.cloudinary.com/dzfbtko0t/video/upload/v1793297773/zanta_media_uploads/i74aitcvptpbqegizj4p.mp4"
              },
              caption: text,
              mentions: [userJid],
              gifPlayback: true
            });
          }
        } catch (sendError) {
          console.error("[WELCOME/GOODBYE] Send failed:", sendError.message);
        }
      }
    } catch (error) {
      console.error("[WELCOME/GOODBYE] Event error:", error.message);
    }
  });

  const handleMessage = async (msg) => {
    try {
      if (!msg || !msg.message) return;

      const from = msg.key.remoteJid;
      if (!from) return;

      const currentBotNumber = (sock.user?.id || "").split(":")[0].replace(/[^0-9]/g, "");
      if (!currentBotNumber) return;

      const ownerJid = `${currentBotNumber}@s.whatsapp.net`;
      const settings = await getBotSettings(currentBotNumber);

      const isGroup = from.endsWith("@g.us");

      let sender = isGroup ? (msg.key.participant || msg.participant) : from;
      if (msg.key.fromMe) {
        sender = ownerJid;
      }
      const senderClean = String(sender || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

      // ════════════════ USER SECURITY & AUTO REACT SETTINGS ════════════════════════
      const botFeatures = await readBotMetaValue(`features_${currentBotNumber}`, {});
      const bannedNumbers = await readBotMetaValue(`banned_${currentBotNumber}`, []);
      const isBannedUser = !msg.key.fromMe && Array.isArray(bannedNumbers) &&
        bannedNumbers.map(n => String(n).replace(/[^0-9]/g, "")).includes(senderClean);
      if (isBannedUser) return;


      const isDev = Boolean(
        senderClean &&
        (senderClean === DEVELOPER_NUMBER ||
          (DEVELOPER_LID && senderClean === DEVELOPER_LID))
      );

      const isBotOwner = Boolean(
        msg.key.fromMe ||
        senderClean === currentBotNumber
      );

      const isOwner = Boolean(isDev || isBotOwner);
      const body = extractMessageBody(msg);
      const cleanBody = body.trim();

      // ════════════════ 30-SETTING MESSAGE AUTOMATIONS ════════════════
      const plainText = cleanBody.toLowerCase();
      if (!msg.key.fromMe && botFeatures?.autoRead) {
        try { await sock.readMessages([msg.key]); } catch (e) {}
      }
      if (!msg.key.fromMe && botFeatures?.autoReply && botFeatures.replyTrigger &&
          plainText.includes(String(botFeatures.replyTrigger).toLowerCase()) && botFeatures.replyText) {
        try { await sock.sendMessage(from, { text: String(botFeatures.replyText).slice(0, 1000) }, { quoted: msg }); } catch (e) {}
      }
      const moderationEnabled = Boolean(botFeatures?.antiLink || botFeatures?.antiBadword || botFeatures?.antiSpam ||
        botFeatures?.antiTag || botFeatures?.antiForward || botFeatures?.antiMedia || botFeatures?.antiAudio ||
        botFeatures?.antiSticker || botFeatures?.antiDocument);
      if (!msg.key.fromMe && isGroup && !isOwner && moderationEnabled) {
        const isAdminForModeration = await (async () => {
          try { const md = await sock.groupMetadata(from); const me = md.participants?.find(x => (x.id || x.jid || "").split(":")[0] === (sock.user?.id || "").split(":")[0]); return Boolean(me?.admin); } catch (e) { return false; }
        })();
        const canModerate = isAdminForModeration;
        const deleteCurrent = async (reason) => {
          if (canModerate) { try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) {} }
          try { await sock.sendMessage(from, { text: `⚠️ @${senderClean} ${reason}`, mentions: [sender] }); } catch (e) {}
        };
        // Anti-spam: count repeated messages per sender in a rolling 10-second window.
        if (botFeatures?.antiSpam) {
          if (!global.zantaSpamTracker) global.zantaSpamTracker = new Map();
          const spamKey = `${from}:${senderClean}`;
          const now = Date.now();
          const previous = global.zantaSpamTracker.get(spamKey) || [];
          const recent = previous.filter(t => now - t < 10000);
          recent.push(now);
          global.zantaSpamTracker.set(spamKey, recent);
          const limit = Math.max(3, Math.min(20, Number(botFeatures.spamLimit) || 5));
          if (recent.length > limit) { await deleteCurrent("Please slow down. Spam is restricted."); return; }
        }
        const hasLink = /https?:\/\/|www\.|chat\.whatsapp\.com\//i.test(cleanBody);
        if (botFeatures?.antiLink && hasLink) {
          if (botFeatures.linkAction !== "warn") await deleteCurrent("Links are restricted in this group.");
          else await sock.sendMessage(from, { text: `⚠️ @${senderClean} Links are not allowed.`, mentions: [sender] });
          if (botFeatures.linkAction !== "warn") return;
        }
        const badWords = Array.isArray(botFeatures?.badWords) ? botFeatures.badWords : [];
        if (botFeatures?.antiBadword && badWords.some(w => w && plainText.includes(String(w).toLowerCase()))) {
          await deleteCurrent("Please avoid prohibited words."); return;
        }
        if (botFeatures?.antiTag && (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []).length >= 5) {
          await deleteCurrent("Mass tagging is disabled."); return;
        }
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
        if (botFeatures?.antiForward && (contextInfo.isForwarded || Number(contextInfo.forwardingScore || 0) > 0)) {
          await deleteCurrent("Forwarded messages are restricted."); return;
        }
        const mm = msg.message || {};
        if (botFeatures?.antiMedia && (mm.imageMessage || mm.videoMessage)) { await deleteCurrent("Photo/video messages are restricted."); return; }
        if (botFeatures?.antiAudio && (mm.audioMessage || mm.ptvMessage)) { await deleteCurrent("Audio messages are restricted."); return; }
        if (botFeatures?.antiSticker && mm.stickerMessage) { await deleteCurrent("Stickers are restricted."); return; }
        if (botFeatures?.antiDocument && mm.documentMessage) { await deleteCurrent("Documents are restricted."); return; }
      }
      if (msg.key.fromMe && !cleanBody.startsWith(settings?.prefix || ".")) {
        return;
      }

      const reply = async (text) => {
        return await sock.sendMessage(from, { text: String(text) }, { quoted: msg });
      };

      // ════════════════ AI VOICE AUTO-REPLY (SINHALA STT + OPENROUTER) ════════════════
      // Incoming voice notes are transcribed, then answered naturally in Sinhala.
      const incomingAudio = msg.message?.audioMessage ||
        msg.message?.ephemeralMessage?.message?.audioMessage ||
        msg.message?.viewOnceMessage?.message?.audioMessage;
      if (!msg.key.fromMe && incomingAudio && process.env.SUPUN_AI_API_KEY && process.env.OPENROUTER_API_KEY) {
        try {
          const audioBuffer = await downloadMediaMessage(msg, "buffer", {}, { logger: console });
          if (!audioBuffer?.length || audioBuffer.length > 20 * 1024 * 1024) {
            await reply("⚠️ Voice message එක හිස් හෝ විශාල වැඩියි.");
            return;
          }

          const FormData = require("form-data");
          const form = new FormData();
          const audioMime = incomingAudio.mimetype || "audio/ogg";
          const audioExt = audioMime.includes("mpeg") ? "mp3" : audioMime.includes("mp4") ? "m4a" : "ogg";
          form.append(process.env.SUPUN_STT_FILE_FIELD || "file", audioBuffer, {
            filename: `voice.${audioExt}`,
            contentType: audioMime
          });
          const sttUrl = process.env.SUPUN_STT_API_URL || "https://supunofc.site/api/ai/ai/openai?q";
          const sttParams = {};
          sttParams[process.env.SUPUN_STT_KEY_PARAM || "apikey"] = process.env.SUPUN_AI_API_KEY;
          if (process.env.SUPUN_STT_LANG) sttParams.lang = process.env.SUPUN_STT_LANG;

          const sttResponse = await axios.post(sttUrl, form, {
            params: sttParams,
            headers: form.getHeaders(),
            timeout: Number(process.env.SUPUN_STT_TIMEOUT || 90000),
            maxBodyLength: 25 * 1024 * 1024,
            maxContentLength: 25 * 1024 * 1024
          });

          const sttData = sttResponse.data;
          const transcript = String(
            sttData?.text || sttData?.transcription || sttData?.result?.text ||
            sttData?.data?.text || sttData?.data?.transcription || ""
          ).trim();

          if (!transcript) {
            console.warn("[VOICE-AI] STT returned no transcript:", JSON.stringify(sttData).slice(0, 500));
            await reply("🎙️ Voice message එක තේරුම් ගන්න බැරි වුණා. ආයෙත් පැහැදිලිව එවන්න.");
            return;
          }

          const aiResponse = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content: "ඔබ ZANTA-XMD WhatsApp සහායකයායි. පරිශීලකයාගේ පණිවිඩයට ස්වභාවික, කෙටි, මිත්‍රශීලී සිංහලෙන් පිළිතුරු දෙන්න. අවශ්‍ය නම් පරිශීලකයා භාවිතා කළ භාෂාවෙන් පිළිතුරු දෙන්න. හඳුනාගත නොහැකි දේවල් ගැන අනුමාන නොකරන්න."
                },
                { role: "user", content: transcript }
              ],
              temperature: 0.7,
              max_tokens: 180
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": process.env.DASHBOARD_URL || "https://zanta-xmd-web-ba8fef131a8f.herokuapp.com/",
                "X-Title": "ZANTA-XMD Voice Reply"
              },
              timeout: 60000
            }
          );

          const answer = String(aiResponse.data?.choices?.[0]?.message?.content || "").trim();
          if (answer) await reply(answer.slice(0, 1500));
          else await reply("⚠️ පිළිතුරක් සකස් කරගන්න බැරි වුණා.");
          return;
        } catch (voiceError) {
          console.error("[VOICE-AI] Error:", voiceError.response?.data || voiceError.message);
          await reply("⚠️ Voice reply එක සකස් කිරීමේදී දෝෂයක් ඇති වුණා. ටිකකින් නැවත උත්සාහ කරන්න.");
          return;
        }
      }

      // Handle menu button replies before the normal command parser.
      const menuRoutes = {
        zanta_menu_main: "main",
        zanta_menu_download: "download",
        zanta_menu_group: "group",
        zanta_menu_ai: "ai",
        zanta_menu_settings: "settings",
        zanta_menu_owner: "owner"
      };

      if (menuRoutes[cleanBody]) {
        await sendZantaMenu(sock, from, menuRoutes[cleanBody], msg);
        return;
      }

      // ".menu" opens the interactive menu.
      const menuPrefix = settings?.prefix || ".";
      if (cleanBody.toLowerCase() === `${menuPrefix}menu` ||
          cleanBody.toLowerCase() === `${menuPrefix}help` ||
          cleanBody.toLowerCase() === `${menuPrefix}panel`) {
        try {
          await sendZantaMenu(sock, from, "main", msg);
        } catch (menuError) {
          console.error("Interactive menu send failed:", menuError.message);
          await reply("❌ Interactive menu එක යැවීමට නොහැකි වුණා. Baileys version එක update කර නැවත උත්සාහ කරන්න.");
        }
        return;
      }

      const quotedMsgId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

      if (quotedMsgId && ["1", "2", "3", "4"].includes(cleanBody)) {
        if (global.fbSessions && global.fbSessions.has(quotedMsgId)) {
          const fbSession = global.fbSessions.get(quotedMsgId);
          await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });
          try {
            if (cleanBody === "1") {
              const vidUrl = fbSession.hd || fbSession.sd;
              if (!vidUrl) throw new Error("HD Video not found");
              await sock.sendMessage(from, {
                video: { url: vidUrl },
                caption: `🎬 *${fbSession.title || "Facebook Video"}*\n⚡ HD Quality\n\n> *${settings.botName}*`,
                mimetype: "video/mp4"
              }, { quoted: msg });
            } else if (cleanBody === "2") {
              const vidUrl = fbSession.sd || fbSession.hd;
              if (!vidUrl) throw new Error("SD Video not found");
              await sock.sendMessage(from, {
                video: { url: vidUrl },
                caption: `🎬 *${fbSession.title || "Facebook Video"}*\n⚡ SD Quality\n\n> *${settings.botName}*`,
                mimetype: "video/mp4"
              }, { quoted: msg });
            } else if (cleanBody === "3") {
              const audUrl = fbSession.audio || fbSession.sd;
              await sock.sendMessage(from, {
                audio: { url: audUrl },
                mimetype: "audio/mp4",
                fileName: "fb_audio.mp3"
              }, { quoted: msg });
            }
            await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
            global.fbSessions.delete(quotedMsgId);
            return;
          } catch (fbErr) {
            await reply(`❌ FB Error: ${fbErr.message}`);
            return;
          }
        }

        if (global.songSessions && global.songSessions.has(quotedMsgId)) {
          const session = global.songSessions.get(quotedMsgId);
          await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });
          try {
            if (cleanBody === "1") {
              await sock.sendMessage(from, { audio: { url: session.url }, mimetype: "audio/mp4", fileName: `${session.title}.mp3` }, { quoted: msg });
            } else if (cleanBody === "2") {
              await sock.sendMessage(from, { document: { url: session.url }, mimetype: "audio/mpeg", fileName: `${session.title}.mp3` }, { quoted: msg });
            } else if (cleanBody === "3") {
              const songRes = await axios.get(session.url, { responseType: "arraybuffer", timeout: 45000 });
              const voiceBuf = await convertToWhatsAppVoice(Buffer.from(songRes.data));
              await sock.sendMessage(from, { audio: voiceBuf, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: msg });
            }
            await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
            global.songSessions.delete(quotedMsgId);
            return;
          } catch (e) {
            await reply("❌ Audio Error.");
            return;
          }
        }

        if (global.tiktokSessions && global.tiktokSessions.has(quotedMsgId)) {
          const ttSession = global.tiktokSessions.get(quotedMsgId);
          await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });
          try {
            if (cleanBody === "1") {
              await sock.sendMessage(from, { 
                video: { url: ttSession.hdVideo || ttSession.sdVideo }, 
                caption: `🎬 *${ttSession.title}*\n⚡ HD Quality\n\n> *${settings.botName}*` 
              }, { quoted: msg });
            } else if (cleanBody === "2") {
              await sock.sendMessage(from, { 
                video: { url: ttSession.sdVideo || ttSession.hdVideo }, 
                caption: `🎬 *${ttSession.title}*\n⚡ SD Quality\n\n> *${settings.botName}*` 
              }, { quoted: msg });
            } else if (cleanBody === "3") {
              const rawAudioRes = await axios.get(ttSession.audioUrl, { responseType: "arraybuffer", timeout: 30000 });
              const voiceBuffer = await convertToWhatsAppVoice(Buffer.from(rawAudioRes.data));
              await sock.sendMessage(from, { audio: voiceBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: msg });
            }
            await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
            global.tiktokSessions.delete(quotedMsgId);
            return;
          } catch (e) {
            await reply(`❌ TikTok Error: ${e.message}`);
            return;
          }
        }

        if (global.videoSessions && global.videoSessions.has(quotedMsgId)) {
          const vSession = global.videoSessions.get(quotedMsgId);
          const qualityMap = { "1": "1080p", "2": "720p", "3": "480p", "4": "360p" };

          if (qualityMap[cleanBody]) {
            const selectedQuality = qualityMap[cleanBody];
            await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });
            try {
              const apiKey = botConfig.CHAMA_API_KEY;
              const downloadApi = `https://api.chamindu.site/api/v1/youtube/download?url=${encodeURIComponent(vSession.url)}&quality=${selectedQuality}&format=mp4&api_key=${apiKey}`;

              const qRes = await axios.get(downloadApi, { timeout: 45000 });
              const qData = qRes.data?.data || qRes.data;
              const finalDownloadUrl = qData?.download_url || qData?.direct_url;

              if (finalDownloadUrl) {
                await sock.sendMessage(from, {
                  video: { url: finalDownloadUrl },
                  caption: `🎬 *${vSession.title}*\n⚡ Quality: ${selectedQuality}\n\n> *${settings.botName}*`,
                  mimetype: "video/mp4"
                }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                global.videoSessions.delete(quotedMsgId);
                return;
              }
              await reply("❌ Video download link not found. Try another quality.");
              return;
            } catch (e) {
              await reply("❌ Video Error.");
              return;
            }
          }
        }
      }

      if (msg.key.id && !msg.key.fromMe) {
        global.msgStore.set(msg.key.id, {
          msg,
          from,
          sender: msg.key.participant || from,
          pushName: msg.pushName || "User",
          time: new Date()
        });

        if (global.msgStore.size > 1000) {
          const firstKey = global.msgStore.keys().next().value;
          global.msgStore.delete(firstKey);
        }
      }

      const protocolMsg = msg.message?.protocolMessage;
      if (protocolMsg && protocolMsg.type === 0 && botFeatures?.antiDelete !== false) {
        const deletedId = protocolMsg.key?.id;
        if (deletedId && global.msgStore.has(deletedId)) {
          const cached = global.msgStore.get(deletedId);
          const targetSendJid = settings.antiDeleteRoute === "me" ? ownerJid : cached.from;
          const senderNum = (cached.sender || "").split("@")[0].replace(/[^0-9]/g, "");

          const alertHeader = 
`╭───『 🗑️ 𝐀𝐍𝐓𝐈-𝐃𝐄𝐋𝐄𝐓𝐄 𝐀𝐋𝐄𝐑𝐓 』───◆
│
│ 👤 *Sender:* +${senderNum} (${cached.pushName})
│ 💬 *Chat:* ${cached.from.endsWith("@g.us") ? "Group Chat" : "Private Chat"}
│ ⏰ *Time:* ${cached.time.toLocaleTimeString("en-LK", { timeZone: "Asia/Colombo" })}
│
╰───────────────────────────────◆`;

          try {
            let rawDeletedMsg = cached.msg.message;
            if (rawDeletedMsg.ephemeralMessage) rawDeletedMsg = rawDeletedMsg.ephemeralMessage.message;
            if (rawDeletedMsg.viewOnceMessageV2) rawDeletedMsg = rawDeletedMsg.viewOnceMessageV2.message;
            if (rawDeletedMsg.viewOnceMessage) rawDeletedMsg = rawDeletedMsg.viewOnceMessage.message;

            let deletedText = 
              rawDeletedMsg.conversation ||
              rawDeletedMsg.extendedTextMessage?.text ||
              rawDeletedMsg.imageMessage?.caption ||
              rawDeletedMsg.videoMessage?.caption ||
              "";

            if (rawDeletedMsg.conversation || rawDeletedMsg.extendedTextMessage) {
              await sock.sendMessage(targetSendJid, {
                text: `${alertHeader}\n\n📝 *Deleted Message:*\n${deletedText || "_No Text Content_"}`
              });
            } else if (rawDeletedMsg.imageMessage) {
              const buffer = await downloadMediaMessage(cached.msg, "buffer", {}, { logger: console });
              await sock.sendMessage(targetSendJid, { image: buffer, caption: `${alertHeader}\n\n📝 *Caption:*\n${deletedText || "_No Caption_"}` });
            } else if (rawDeletedMsg.videoMessage) {
              const buffer = await downloadMediaMessage(cached.msg, "buffer", {}, { logger: console });
              await sock.sendMessage(targetSendJid, { video: buffer, caption: `${alertHeader}\n\n📝 *Caption:*\n${deletedText || "_No Caption_"}` });
            } else if (rawDeletedMsg.audioMessage) {
              const buffer = await downloadMediaMessage(cached.msg, "buffer", {}, { logger: console });
              await sock.sendMessage(targetSendJid, { text: alertHeader });
              await sock.sendMessage(targetSendJid, {
                audio: buffer,
                mimetype: rawDeletedMsg.audioMessage.mimetype || "audio/ogg; codecs=opus",
                ptt: rawDeletedMsg.audioMessage.ptt || false
              });
            } else if (rawDeletedMsg.stickerMessage) {
              const buffer = await downloadMediaMessage(cached.msg, "buffer", {}, { logger: console });
              await sock.sendMessage(targetSendJid, { text: alertHeader });
              await sock.sendMessage(targetSendJid, { sticker: buffer });
            }
          } catch (delErr) {}
          return;
        }
      }

      const antiViewEmojis = ["🥺", "🙏", "🌚", "😁", "🤭", "😩", "😂", "🫣", "❤", "👍", "🙌", "🫡", "😍", "🫶", "😶"];
      const quotedMsgRaw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const isEmojiReplyVO = quotedMsgRaw && antiViewEmojis.includes(cleanBody) && (quotedMsgRaw.viewOnceMessageV2 || quotedMsgRaw.viewOnceMessage);

      let voTarget = null;
      let isReplyMode = false;

      if (msg.message?.viewOnceMessageV2) {
        voTarget = msg.message.viewOnceMessageV2.message;
      } else if (msg.message?.viewOnceMessage) {
        voTarget = msg.message.viewOnceMessage.message;
      } else if (isEmojiReplyVO) {
        const qm = quotedMsgRaw.viewOnceMessageV2 || quotedMsgRaw.viewOnceMessage;
        voTarget = qm.message;
        isReplyMode = true;
      }

      if (voTarget && botFeatures?.antiViewOnce !== false && (!msg.key.fromMe || isReplyMode)) {
        const targetViewJid = settings.antiViewRoute === "me" ? ownerJid : from;
        const senderNum = (msg.key.participant || from).split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

        try {
          const isImg = Boolean(voTarget.imageMessage);
          const isVid = Boolean(voTarget.videoMessage);

          if (isImg || isVid) {
            const mediaObj = isImg ? voTarget.imageMessage : voTarget.videoMessage;
            const fakeMessageToDownload = {
              key: isReplyMode ? {
                remoteJid: from,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
              } : msg.key,
              message: voTarget
            };

            const buffer = await downloadMediaMessage(fakeMessageToDownload, "buffer", {}, { logger: console });

            const caption = 
`╭───『 👁 𝐀𝐍𝐓𝐈-𝐕𝐈𝐄𝐖𝐎𝐍𝐂𝐄 』───◆
│
│ 👤 *Sender:* +${senderNum}
│ 📁 *Type:* ${isImg ? "Photo" : "Video"}
│ 📝 *Caption:* ${mediaObj.caption || "No caption"}
│
╰─────────────────────────◆
> *${settings.botName}*`;

            if (isImg) {
              await sock.sendMessage(targetViewJid, { image: buffer, caption }, { quoted: msg });
            } else {
              await sock.sendMessage(targetViewJid, { video: buffer, caption }, { quoted: msg });
            }

            if (isReplyMode) return;
          }
        } catch (voErr) {}
      }

      if (from === "status@broadcast") {
        try {
          if (settings.statusSeen) {
            await sock.readMessages([msg.key]);
          }

          const senderJid = msg.key.participant || msg.participant;
          if (settings.statusReact && settings.statusReact !== "off" && senderJid) {
            await sock.sendMessage(
              senderJid,
              { react: { text: settings.statusReact, key: msg.key } },
              { statusJidList: [senderJid] }
            );
          }
        } catch (e) {}
        return;
      }

      // ════════════════ AUTO REACT SETTING ════════════════════════
      if (botFeatures?.autoReact && !msg.key.fromMe && from !== "status@broadcast") {
        try {
          const emojiList = ["❤️", "🔥", "💚", "⚡", "✨", "💯", "🥰"];
          const emoji = botFeatures?.reactEmoji || emojiList[Math.floor(Math.random() * emojiList.length)];
          await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
        } catch (reactError) {
          console.warn("[AUTO-REACT] Failed:", reactError.message);
        }
      }

      if (!isOwner) {
        const mode = (settings?.workMode || "public").toLowerCase();
        if (mode === "private") return;
        if (mode === "groups" && !isGroup) return;
        if (mode === "inbox" && isGroup) return;
      }

      if (quotedMsgId && global.settingSessions.has(quotedMsgId) && (isOwner || isDev)) {
        const settingCmd = getCommand("setting");
        if (settingCmd && typeof settingCmd.execute === "function") {
          return await settingCmd.execute(sock, msg, [], from, {
            reply, isOwner, isDev, cleanBody, body, sender, DEVELOPER_NAME, DEVELOPER_NUMBER
          });
        }
      }

      if (global.evoiceEnabled === undefined) {
        try {
          const evData = await BotMeta.findOne({ key: "evoice_status" });
          global.evoiceEnabled = evData ? Boolean(evData.value) : false;
        } catch (e) {
          global.evoiceEnabled = false;
        }
      }

      const defaultPrefixes = [".", "!", "#", "/", "*", ","];
      const configuredPrefix = settings?.prefix || ".";
      const isCommandPattern = body.startsWith(configuredPrefix) || defaultPrefixes.some(p => body.startsWith(p));

      if (global.evoiceEnabled && cleanBody && !isCommandPattern) {
        const emojiVoiceMap = {
          "🙏": "https://files.catbox.moe/1e2359.opus",
          "☸️": "https://files.catbox.moe/1e2359.opus",
          "🌹": "https://files.catbox.moe/uxm1re.opus",
          "💆‍♂️": "https://files.catbox.moe/uxm1re.opus",
          "😅": "https://files.catbox.moe/cvv435.opus",
          "🤣": "https://files.catbox.moe/cvv435.opus",
          "😂": "https://files.catbox.moe/cvv435.opus",
          "🫢": "https://files.catbox.moe/i2uw0g.opus",
          "🌚": "https://files.catbox.moe/i2uw0g.opus",
          "💇‍♂️": "https://files.catbox.moe/i2uw0g.opus",
          "🫣": "https://files.catbox.moe/oqfsdl.opus",
          "🤪": "https://files.catbox.moe/oqfsdl.opus",
          "😜": "https://files.catbox.moe/oqfsdl.opus",
          "🥵": "https://files.catbox.moe/bfwnvj.opus",
          "🤤": "https://files.catbox.moe/bfwnvj.opus",
          "🍑": "https://files.catbox.moe/bfwnvj.opus",
          "🫀": "https://files.catbox.moe/bke4vj.opus",
          "💔": "https://files.catbox.moe/bke4vj.opus",
          "🙇‍♂️": "https://files.catbox.moe/bke4vj.opus",
          "🥺": "https://files.catbox.moe/o5270o.opus",
          "😭": "https://files.catbox.moe/o5270o.opus",
          "🥹": "https://files.catbox.moe/o5270o.opus"
        };

        let targetAudio = null;

        if (emojiVoiceMap[cleanBody]) {
          targetAudio = emojiVoiceMap[cleanBody];
        } else {
          for (const emoji of Object.keys(emojiVoiceMap)) {
            if (cleanBody.endsWith(emoji)) {
              targetAudio = emojiVoiceMap[emoji];
              break;
            }
          }
        }

        if (targetAudio) {
          try {
            const audioStream = await axios.get(targetAudio, {
              responseType: "arraybuffer",
              timeout: 25000,
              headers: { "User-Agent": "Mozilla/5.0" }
            });

            const voiceBuf = await convertToWhatsAppVoice(Buffer.from(audioStream.data));

            await sock.sendMessage(from, {
              audio: voiceBuf,
              mimetype: "audio/ogg; codecs=opus",
              ptt: true
            }, { quoted: msg });
            return;
          } catch (evErr) {}
        }
      }

      let matchedPrefix = null;

      if (body.startsWith(configuredPrefix)) {
        matchedPrefix = configuredPrefix;
      } else if (defaultPrefixes.some((p) => body.startsWith(p))) {
        matchedPrefix = defaultPrefixes.find((p) => body.startsWith(p));
      }

      if (!matchedPrefix) return;

      const args = body.slice(matchedPrefix.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();
      if (!commandName) return;

      const targetCommand = getCommand(commandName);

      if (settings.presence === "typing") {
        try {
          await sock.presenceSubscribe(from);
          await sock.sendPresenceUpdate("composing", from);
        } catch (e) {}
      } else if (settings.presence === "recording") {
        try {
          await sock.presenceSubscribe(from);
          await sock.sendPresenceUpdate("recording", from);
        } catch (e) {}
      } else {
        try {
          await sock.sendPresenceUpdate("paused", from);
          await sock.sendPresenceUpdate("available");
        } catch (e) {}
      }

      // ignore stale (replayed after reconnect) commands
      const msgTime = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0);
      if (msgTime && Date.now() / 1000 - msgTime > 300) return;

      if (targetCommand && typeof targetCommand.execute === "function") {
        try {
          if (botFeatures?.commandLog && !msg.key.fromMe) {
            try { await sock.sendMessage(ownerJid, { text: `🧾 Command Log\nUser: ${senderClean}\nChat: ${from}\nCommand: ${matchedPrefix}${commandName}` }); } catch (e) {}
          }
          await targetCommand.execute(sock, msg, args, from, {
            body,
            cleanBody,
            prefix: matchedPrefix,
            sender,
            isOwner,
            isDev,
            isBotOwner,
            isGroup,
            reply,
            settings,
            currentBotNumber,
            DEVELOPER_NAME,
            DEVELOPER_NUMBER,
            DEVELOPER_LID,
            botConfig
          });
        } catch (cmdErr) {
          console.error(`❌ Execution error in ${commandName}:`, cmdErr);
          await reply(`⚠️ Error executing *${commandName}*:\n_${cmdErr.message}_`);
        }
      }

    } catch (e) {
      console.error("❌ messages.upsert Error:", e);
    }
  };

  sock.ev.on("messages.upsert", async (chatUpdate) => {
    for (const m of chatUpdate.messages || []) {
      await handleMessage(m);
    }
  });
}

// Keep the latest live WhatsApp connection available to dashboard2.js.
let conn = null;
let dashboard2Attached = false;

onSocketCreated((sock) => {
  if (sock && global.activeBotSockets) {
    global.activeBotSockets.add(sock);
  }
  if (sock) conn = sock;
  initBot(sock);

  // Register dashboard2 routes once a live connection is available.
  if (conn && !dashboard2Attached) {
    const attachDashboard2 = require('./dashboard2');
    attachDashboard2(app, { mongoose, sock: conn });
    dashboard2Attached = true;
  }
});

/* =========================================================
   WEB UI & PAIR SERVICE (FAST LIGHTWEIGHT)
========================================================= */

// ════════════════ PREMIUM BLACK & RED PAIRING WEBSITE ════════════════════════
// Secure multi-page ZANTA-XMD OFC dashboard (MongoDB-backed).
require('./web-dashboard')(app, { mongoose, requestPairCode, botName: BOT_NAME, botLogo: BOT_LOGO, developerName: DEVELOPER_NAME, commandsDir });

// dashboard2.js is attached from onSocketCreated above, where the live `conn` exists.
// Keep its implementation and any credentials server-side.

// The main dashboard does not serve or load public/react.html.

// ════════════════ LIVE MONGODB BOT COUNT API ════════════════════════
// Count persistent WhatsApp sessions stored in darkdinusessions.
app.get("/api/stats", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ totalBots: 0, totalCommands: commands.size, database: "disconnected" });
    const totalBots = await mongoose.connection.db.collection("darkdinusessions").countDocuments({});
    const totalCommands = commands.size;
    return res.json({ totalBots, totalCommands, database: "connected", updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("❌ Live bot count error:", error.message);
    return res.status(500).json({ totalBots: 0, totalCommands: commands.size, database: "error" });
  }
});

// ════════════════ SAFE WEBSITE COMMAND TEST API ════════════════════════
// Resolves every loaded command and alias. Only commands explicitly supporting
// webPreview are executed; all others receive a safe metadata/argument simulation.
// This prevents website visitors from triggering WhatsApp sends, group moderation,
// downloads, filesystem changes, or third-party API calls.
const commandTestHits = new Map();
app.post("/api/command-test", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const previous = commandTestHits.get(ip) || 0;
  if (now - previous < 1800) return res.status(429).json({ error: "Please wait a moment before testing again." });
  commandTestHits.set(ip, now);
  if (commandTestHits.size > 5000) {
    for (const [key, time] of commandTestHits) if (now - time > 10 * 60 * 1000) commandTestHits.delete(key);
  }

  const expectedToken = String(PAIR_TEST_TOKEN || "");
  const suppliedToken = String(req.body?.token || "");
  if (!expectedToken) return res.status(503).json({ error: "Website command test is disabled. Set PAIR_TEST_TOKEN in Heroku Config Vars." });
  const crypto = require("crypto");
  const a = Buffer.from(suppliedToken);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid website test access token." });
  }

  const rawCommand = String(req.body?.command || "").trim();
  if (!rawCommand || rawCommand.length > 500) return res.status(400).json({ error: "Enter a command (maximum 500 characters)." });
  const parts = rawCommand.replace(/^[.!#/*,]+/, "").trim().split(/\s+/);
  const requestedName = String(parts.shift() || "").toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(requestedName)) return res.status(400).json({ error: "Invalid command name." });

  const command = getCommand(requestedName);
  if (!command || typeof command.execute !== "function") {
    const suggestions = [...commands.keys()].filter((name) => name.includes(requestedName)).slice(0, 8);
    return res.status(404).json({ error: `Command “${requestedName}” is not loaded.`, suggestions });
  }

  const canonicalName = String(command.name || requestedName).toLowerCase();
  const args = parts;
  const aliasesForCommand = Array.isArray(command.alias) ? command.alias : [];

  // Alive has a dedicated, side-effect-free preview implementation.
  if (canonicalName === "alive") {
    let output = "";
    const previewSock = { sendMessage: async () => ({ key: { id: "WEB_PREVIEW" } }) };
    const previewMsg = { pushName: "Website Tester", key: { fromMe: true, remoteJid: "web-preview" } };
    try {
      await command.execute(previewSock, previewMsg, args, "web-preview", {
        webPreview: true,
        reply: async (text) => { output = String(text ?? ""); return { preview: true }; },
        isOwner: true,
        settings: { botName: BOT_NAME, workMode: "public" }
      });
      return res.json({ success: true, mode: "live-preview", command: `.${canonicalName}`, output: output || "Alive command returned no text.", note: "Safe preview; not sent to WhatsApp." });
    } catch (error) {
      console.error("Website alive preview error:", error.message);
      return res.status(500).json({ error: "Alive preview failed." });
    }
  }

  // For every other command, validate command/alias and show exactly what would
  // be dispatched, without executing potentially destructive or external actions.
  const description = String(command.desc || command.description || "No description provided.").slice(0, 300);
  const usage = String(command.use || command.usage || `.${canonicalName}`).slice(0, 300);
  const category = String(command.category || "general").slice(0, 80);
  const output = [
    `╭━━〔 ZANTA-XMD COMMAND TEST 〕━━╮`,
    `┃ STATUS : COMMAND FOUND ✓`,
    `┃ COMMAND : .${canonicalName}`,
    `┃ INPUT : ${rawCommand}`,
    `┃ CATEGORY : ${category}`,
    `┃ DESCRIPTION : ${description}`,
    `┃ USAGE : ${usage}`,
    `┃ ALIASES : ${aliasesForCommand.length ? aliasesForCommand.join(", ") : "None"}`,
    `┃ ARGUMENTS : ${args.length ? args.join(" | ") : "None"}`,
    `╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`,
    ``,
    `✓ Command loader found this command and resolved its alias.`,
    `ℹ SAFE SIMULATION: The command's real execute() function was not run.`,
    `No WhatsApp message, group action, download, file change or external API request was made.`,
    ``,
    `To see the real command response, test it in the bot's WhatsApp chat.`
  ].join("\n");

  return res.json({
    success: true,
    mode: "safe-simulation",
    command: `.${canonicalName}`,
    requested: rawCommand,
    output,
    note: "Command and arguments validated; execution safely simulated.",
    totalCommands: commands.size
  });
});

// Pairing is exposed only through authenticated POST /api/pair.

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "alive",
    bot: BOT_NAME,
    uptime: process.uptime(),
    activeBots: global.activeBotSockets ? global.activeBotSockets.size : 0
  });
});

// keep in-memory session maps from growing forever
setInterval(() => {
  for (const name of ["msgStore", "songSessions", "tiktokSessions", "fbSessions", "videoSessions", "settingSessions"]) {
    const map = global[name];
    if (!map) continue;
    const limit = name === "msgStore" ? 1000 : 200;
    while (map.size > limit) map.delete(map.keys().next().value);
  }
}, 5 * 60 * 1000).unref();

async function connectMongo() {
  if (!MONGO_URI) {
    console.error("❌ MONGODB_URI is missing. Add it to your .env file.");
    return false;
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`🔄 Connecting to MongoDB... (try ${attempt}/5)`);
      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 15000,
        maxPoolSize: 10
      });
      console.log("\x1b[32m%s\x1b[0m", "✅ [DATABASE] MongoDB connected!");
      return true;
    } catch (err) {
      console.error(`❌ MongoDB connection error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  return false;
}

async function start() {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 ${BOT_NAME} RUNNING ON PORT: ${PORT}`);
  });

  const connected = await connectMongo();
  if (!connected) return;

  restoreCredentials().catch((err) => {
    console.error("❌ Session restore error:", err.message);
  });
}

const shutdown = async () => {
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
