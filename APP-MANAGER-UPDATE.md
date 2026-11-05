ZANTA-XMD OFC — App Manager Update

- Removed dashboard ZANTA AI page, tile, navigation, chat JavaScript, AI configuration panel, and /api/ai/chat backend route.
- Added a styled App Manager: App Name, App URL, Coins, Add App, and Delete button for each app.
- Added owner-protected app create/delete endpoints.
- App unlock now charges the configured coin price (minimum 1 coin).
- Existing MongoDB app records are loaded and shown in the owner panel.

Deploy the full ZIP. Keep MongoDB and ADMIN_EMAIL / ADMIN_USERNAME / ADMIN_PASSWORD environment variables. Sign in through the private owner-console route.
