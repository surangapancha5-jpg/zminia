ZANTA-XMD OFC — UI / SETTINGS UPDATE

Changed files:
- public/index.html: fixed bottom developer signature on mobile and desktop; redesigned WhatsApp pairing page; added settings cards for language, theme color, country/timezone live clock, profile picture (DP), and developer support form; local preferences saved in browser storage.
- public/user-dashboard.html: synchronized copy of the updated dashboard.
- user-dashboard.html: synchronized root-level copy of the updated dashboard.
- web-dashboard.js: added authenticated support ticket submission and admin-only support inbox API; tickets are stored in MongoDB collection zanta_support_tickets.

Languages available: Sinhala, English, Tamil, Simplified Chinese, Japanese, Arabic, Korean.
Themes available: Ocean Blue, Royal Purple, Neon Green, Ruby Red, Luxury Gold.

Notes:
- Profile picture is stored locally in the user's browser (up to 3 MB), not uploaded to the server.
- Theme, language, and selected timezone are saved in localStorage on the device.
- Country time is shown using the selected IANA timezone and updates every second.
- Developer support messages require a logged-in account and are stored in MongoDB; the admin inbox is visible in the private owner console.
