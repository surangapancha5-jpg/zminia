const axios = require("axios");

const GIFT_VIDEO =
  "https://res.cloudinary.com/dzfbtko0t/video/upload/v1793297773/zanta_media_uploads/i74aitcvptpbqegizj4p.mp4";

const ROUND_VIDEO =
  "https://res.cloudinary.com/dzfbtko0t/video/upload/v1793441357/zanta_media_uploads/fywcjhso98ylcb7axtiv.mp4";

// Cache variables
let videoCache = null;
let videoLoading = false;
let roundVideoCache = null;
let roundVideoLoading = false;

async function downloadVideo(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    if (!response.data || response.data.length === 0) {  
        throw new Error("Empty video response");  
    }  

    return Buffer.from(response.data);
  } catch (err) {
    console.error(`[DOWNLOAD ERROR] Failed to fetch ${url}:`, err.message);
    throw err;
  }
}

async function getGiftVideo() {
  if (videoCache) return videoCache;
  if (videoLoading) {  
      for (let i = 0; i < 30; i++) {  
          await new Promise(resolve => setTimeout(resolve, 1000));  
          if (videoCache) return videoCache;  
      }  
      throw new Error("Gift video loading timeout");  
  }  

  videoLoading = true;  
  try {  
      videoCache = await downloadVideo(GIFT_VIDEO);  
      return videoCache;  
  } finally {  
      videoLoading = false;  
  }
}

async function getRoundVideo() {
  if (roundVideoCache) return roundVideoCache;
  if (roundVideoLoading) {  
      for (let i = 0; i < 30; i++) {  
          await new Promise(resolve => setTimeout(resolve, 1000));  
          if (roundVideoCache) return roundVideoCache;  
      }  
      throw new Error("Round video loading timeout");  
  }  

  roundVideoLoading = true;  
  try {  
      roundVideoCache = await downloadVideo(ROUND_VIDEO);  
      return roundVideoCache;  
  } finally {  
      roundVideoLoading = false;  
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function getTotalCommands() {
  const commands = global.commands;
  if (commands instanceof Map) return commands.size;  
  if (Array.isArray(commands)) return commands.length;  
  if (commands && typeof commands === "object") {  
      return Object.keys(commands).length;  
  }  
  return 0;
}

module.exports = {
  name: "ping",
  alias: ["speed", "pong"],
  desc: "ZANTA-XMD Ping Status",
  category: "main",
  use: ".ping",

  async execute(sock, msg, args, from, { reply }) {  
      const start = Date.now();  

      try {  
          const totalCmds = getTotalCommands();  
          const timestamp = Number(msg.messageTimestamp);  
          const speed = timestamp ? Math.max(0, start - timestamp * 1000) : 0;  

          const message = `╭━━〔 𝐙𝐀𝐍𝐓𝐀-𝐗𝐌𝐃 〕━━┈⊷
┃◈╭─────────────·๏
┃◈┃• 🤠 𝐇𝐞𝐥𝐥𝐨: ${msg.pushName || "User"}
┃◈┃• 🪪 𝐕𝐞𝐫𝐬𝐢𝐨𝐧: 2.2.0
┃◈└───────────┈⊷
╰──────────────┈⊷

╭━━〔 𝐁𝐎𝐓 𝐒𝐓𝐀𝐓𝐔𝐒 〕━━┈⊷
┃◈╭─────────────·๏
┃◈┃⛩️ 𝐒𝐓𝐀𝐓𝐔𝐒 ONLINE 🟢
┃◈┃
┃◈┃⛩️ 𝐒𝐏𝐄𝐄𝐃 ${speed}ms
┃◈┃
┃◈┃⛩️ 𝐔𝐏𝐓𝐈𝐌𝐄 ${formatUptime(process.uptime())}
┃◈┃
┃◈┃⛩️ 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 ${totalCmds}+
┃◈┃
┃◈┃⛩️ 𝐎𝐖𝐍𝐄𝐑 𝙼𝚁 𝚂𝚄𝚁𝙰𝙽𝙶𝙰 𝙼𝙾𝙳-𝚉
┃◈┃
┃◈└───────────┈⊷
╰──────────────┈⊷

> 𝐙𝐀𝐍𝐓𝐀-𝐗𝐌𝐃 𝐎𝐅𝐂`;

          // 1. Send Round Video (Video Note / PTV)
          try {  
              const roundVideo = await getRoundVideo();  
              if (roundVideo) {
                  await sock.sendMessage(  
                      from,  
                      {  
                          video: roundVideo,  
                          mimetype: "video/mp4",  
                          ptv: true  
                      },  
                      { quoted: msg }  
                  );  
              }
          } catch (roundError) {  
              console.error("[PING ROUND VIDEO ERROR]", roundError.message);  
          }  

          // 2. Button Configuration
          const buttons = [
              {
                  buttonId: ".menu",
                  buttonText: { displayText: "📜 MENU" },
                  type: 1
              },
              {
                  buttonId: ".owner",
                  buttonText: { displayText: "👨‍💻 OWNER" },
                  type: 1
              }
          ];

          // 3. Send Gift Video with Caption and Buttons
          try {  
              const video = await getGiftVideo();  
              if (video) {
                  await sock.sendMessage(  
                      from,  
                      {  
                          video: video,  
                          mimetype: "video/mp4",  
                          gifPlayback: true,  
                          caption: message,
                          footer: "ZANTA-XMD SYSTEM",
                          buttons: buttons,
                          headerType: 4
                      },  
                      { quoted: msg }  
                  );  
                  return;
              }
          } catch (videoError) {  
              console.error("[PING GIFT VIDEO ERROR]", videoError.message);  
          }  

          // Fallback: Text + Buttons if video fails
          await sock.sendMessage(
              from, 
              { 
                  text: message,
                  footer: "ZANTA-XMD SYSTEM",
                  buttons: buttons,
                  headerType: 1
              }, 
              { quoted: msg }
          );

      } catch (error) {  
          console.error("[PING COMMAND ERROR]", error);  
          try {  
              await reply("❌ PING ERROR!\nError: " + error.message);  
          } catch (replyError) {  
              console.error("[PING REPLY ERROR]", replyError.message);  
          }  
      }  
  }
};
