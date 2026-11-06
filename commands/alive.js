const axios = require("axios");

const GIFT_VIDEO =
    "https://res.cloudinary.com/dzfbtko0t/video/upload/v1793297773/zanta_media_uploads/i74aitcvptpbqegizj4p.mp4";

const ROUND_VIDEO =
    "https://res.cloudinary.com/dzfbtko0t/video/upload/v1793441357/zanta_media_uploads/fywcjhso98ylcb7axtiv.mp4";

const MAX_VIDEO_SIZE = 25 * 1024 * 1024;

let videoCache = null;
let roundVideoCache = null;

let videoPromise = null;
let roundVideoPromise = null;

async function downloadVideo(url) {
    const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 60000,
        maxContentLength: MAX_VIDEO_SIZE,
        maxBodyLength: MAX_VIDEO_SIZE,
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "video/mp4,*/*"
        }
    });

    const buffer = Buffer.from(response.data);

    if (!buffer.length) {
        throw new Error("Downloaded video is empty");
    }

    if (buffer.length > MAX_VIDEO_SIZE) {
        throw new Error("Video exceeds 25MB limit");
    }

    // MP4 files normally contain the ftyp signature near the beginning.
    if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") {
        throw new Error("Invalid MP4 video response");
    }

    return buffer;
}

async function getGiftVideo() {
    if (videoCache) return videoCache;

    if (!videoPromise) {
        videoPromise = downloadVideo(GIFT_VIDEO)
            .then(buffer => {
                videoCache = buffer;
                return buffer;
            })
            .finally(() => {
                videoPromise = null;
            });
    }

    return videoPromise;
}

async function getRoundVideo() {
    if (roundVideoCache) return roundVideoCache;

    if (!roundVideoPromise) {
        roundVideoPromise = downloadVideo(ROUND_VIDEO)
            .then(buffer => {
                roundVideoCache = buffer;
                return buffer;
            })
            .finally(() => {
                roundVideoPromise = null;
            });
    }

    return roundVideoPromise;
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

            const speed = timestamp
                ? Math.max(0, start - timestamp * 1000)
                : 0;

            const message =
`╭━━〔 *𝐙𝐀𝐍𝐓𝐀-𝐗𝐌𝐃* 〕━━┈⊷
┃◈╭─────────────·๏
┃◈┃• *🤠 𝐇𝐞𝐥𝐥𝐨:* ${msg.pushName || "User"}
┃◈┃• *🪪 𝐕𝐞𝐫𝐬𝐢𝐨𝐧:* *2.2.0*
┃◈└───────────┈⊷
╰──────────────┈⊷

╭━━〔 *𝐁𝐎𝐓 𝐒𝐓𝐀𝐓𝐔𝐒* 〕━━┈⊷
┃◈╭─────────────·๏
┃◈┃⛩️ *𝐒𝐓𝐀𝐓𝐔𝐒:* ONLINE 🟢
┃◈┃
┃◈┃⛩️ *𝐒𝐏𝐄𝐄𝐃:* ${speed}ms
┃◈┃
┃◈┃⛩️ *𝐔𝐏𝐓𝐈𝐌𝐄:* ${formatUptime(process.uptime())}
┃◈┃
┃◈┃⛩️ *𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒:* ${totalCmds}+
┃◈┃
┃◈┃⛩️ *𝐎𝐖𝐍𝐄𝐑:* 𝙼𝚁 𝚂𝚄𝚁𝙰𝙽𝙶𝙰 𝙼𝙾𝙳-𝚉
┃◈└───────────┈⊷
╰──────────────┈⊷

> 𝐙𝐀𝐍𝐓𝐀-𝐗𝐌𝐃 𝐎𝐅𝐂`;

            // 1. Send Round Video Note
            try {
                const roundVideo = await getRoundVideo();

                await sock.sendMessage(from, {
                    video: roundVideo,
                    mimetype: "video/mp4",
                    ptv: true
                }, {
                    quoted: msg
                });

            } catch (error) {
                console.error("[PING ROUND VIDEO ERROR]", error);
            }

            // 2. Send Gift Video with Ping Status
            try {
                const giftVideo = await getGiftVideo();

                await sock.sendMessage(from, {
                    video: giftVideo,
                    mimetype: "video/mp4",
                    gifPlayback: true,
                    caption: message
                }, {
                    quoted: msg
                });

            } catch (error) {
                console.error("[PING GIFT VIDEO ERROR]", error);

                await sock.sendMessage(from, {
                    text: message
                }, {
                    quoted: msg
                });
            }

        } catch (error) {
            console.error("[PING COMMAND ERROR]", error);

            try {
                await reply(
                    "❌ PING ERROR!\n" +
                    "Error: " + error.message
                );
            } catch (replyError) {
                console.error("[PING REPLY ERROR]", replyError);
            }
        }
    }
};