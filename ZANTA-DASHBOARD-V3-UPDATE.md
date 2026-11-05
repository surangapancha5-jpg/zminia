# ZANTA-XMD OFC Dashboard V3 Update

## Dashboard
- User identity strip remains on the left with DP and username; live country clock is aligned to the right.
- Animated Personal Control Center heading and welcome message.
- VIP Rewards area now includes a CLAIMED TODAY counter showing one-time YouTube/WhatsApp reward claims.
- Profile page includes an About section explaining coin earning and usage.
- Pair code is displayed in a compact copy box with a Copy Code button.
- Header security label is replaced by an SVG notification bell that opens Notifications and shows an unread indicator.

## Admin Dashboard Layout & Text Studio
- Admin can edit home dashboard box order, widths (3–12 grid columns), and key text labels through the Dashboard Layout & Text Studio JSON editor.
- Settings are stored in MongoDB under `zanta_config` key `dashboardUI` and delivered through `/api/dashboard`.
- Allowed home boxes: `clock`, `hero`, `balance`, `tiles`, `rewards`.
- Example:
  {
    "order": ["clock", "hero", "balance", "tiles", "rewards"],
    "sizes": {"clock": 12, "hero": 12, "balance": 6, "tiles": 6, "rewards": 12},
    "text": {"kicker": "YOUR PERSONAL CONTROL CENTER", "welcome": "Hey,", "subtitle": "Everything you need, one tap away.", "balance": "YOUR BALANCE", "rewards": "VIP REWARDS"}
  }

## Changed files
- `public/index.html`
- `public/user-dashboard.html`
- `user-dashboard.html`
- `web-dashboard.js`
- `ZANTA-DASHBOARD-V3-UPDATE.md`
