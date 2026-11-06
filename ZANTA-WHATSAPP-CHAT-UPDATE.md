# ZANTA WhatsApp-style chat update

## Changes
- Removed the Status feature endpoints from the dashboard backend; no Status tab or Status UI is included.
- Added/retained RGB New Group button and group list with group initials/logo and name.
- Group creation can include only friends whose invitations have been accepted.
- Group admin can add accepted friends and remove existing members; non-admin members do not see the Add Friend control.
- Group and private conversations open in full-screen layouts with Back buttons.
- Own messages align right; other members' messages align left.
- Each message shows the sender name and an initials avatar.
- Tapping a message opens reactions and a Reply action. Replies include a quoted sender and message excerpt.
- Existing OTP registration and Gmail settings are preserved.

## Files changed
- web-dashboard.js
- public/user-dashboard.html
- user-dashboard.html

## Validation
- `node --check web-dashboard.js` passed.
- Inline JavaScript syntax checks passed for both dashboard HTML files.
- ZIP integrity checked after packaging.
- Live Heroku/MongoDB interaction was not tested in this environment.

## Group Info / RGB UI Update (2026-11-06)
- New group creation uses an RGB dialog with a group name and checkbox selection of accepted friends.
- Group profile supports an image DP; group avatars use animated RGB rings.
- Group Info includes member list, owner-only admin promotion/demotion and rename, admin member removal, and wallpaper controls.
- Group owner is protected from removal by the API.
- Private Chat Info includes wallpaper controls.
- Message reactions were removed from the chat UI; tapping a message now starts a reply.
- Wallpaper images are saved in the current browser's localStorage (not synchronized across devices).
- Group DP is stored in MongoDB as a data URL; choose an image smaller than 850 KB.
