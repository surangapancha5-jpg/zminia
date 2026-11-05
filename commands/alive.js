const axios = require("axios");

module.exports = {
    name: "alive",
    alias: ["online", "status"],
    desc: "Check bot online status",
    category: "main",
    use: ".alive",

    async execute(sock, msg, args, from, { reply }) {

        const start = Date.now();
        let loading;

        try {

            // Loading Message
            loading = await sock.sendMessage(from, {
                text: "✨ *ZANTA-XMD is checking status...*"
            }, { quoted: msg });

            // Video URL
            const videoUrl =
                "https://res.cloudinary.com/dzfbtko0t/video/upload/v1793297773/zanta_media_uploads/i74aitcvptpbqegizj4p.mp4";

            // Bot Information
            const speed = Date.now() - start;
            const uptime = formatUptime(process.uptime());

            const aliveText = `
╭━━━〔 ⚡ ZANTA-XMD MINI ⚡ 〕━━━┈⊷
┃
┃  ✨ *BOT STATUS*
┃
┃  ◈ STATUS : ONLINE 🟢
┃  ◈ BOT : ZANTA-XMD
┃  ◈ USER : ${msg.pushName || "User"}
┃  ◈ SPEED : ${speed} ms
┃  ◈ UPTIME : ${uptime}
┃  ◈ MODE : PUBLIC
┃
┃  🚀 *ALL SYSTEMS WORKING*
┃
╰━━━━━━━━━━━━━━━━━━━━┈⊷

> © POWERED BY ZANTA MD | 2026 💫
`;

            let sent = false;

            // Download Video
            try {

                const response = await axios.get(videoUrl, {
                    responseType: "arraybuffer",
                    timeout: 20000,
                    maxContentLength: 50 * 1024 * 1024
                });

                const videoBuffer = Buffer.from(response.data);

                // Send GIF Video
                await sock.sendMessage(from, {
                    video: videoBuffer,
                    caption: aliveText,
                    mimetype: "video/mp4",
                    gifPlayback: true
                }, { quoted: msg });

                sent = true;

            } catch (err) {

                console.log("ALIVE VIDEO ERROR:", err.message);

            }

            // Text Fallback
            if (!sent) {

                await sock.sendMessage(from, {
                    text: aliveText
                }, { quoted: msg });

            }

            // Delete Loading
            if (loading && loading.key) {

                try {
                    await sock.sendMessage(from, {
                        delete: loading.key
                    });
                } catch (_) {}

            }

        } catch (error) {

            console.error("ALIVE ERROR:", error);

            if (loading && loading.key) {
                try {
                    await sock.sendMessage(from, {
                        delete: loading.key
                    });
                } catch (_) {}
            }

            await reply("❌ Alive command failed!");

        }
    }
};


// Uptime Formatter
function formatUptime(seconds) {

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}