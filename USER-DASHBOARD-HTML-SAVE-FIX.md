# User Dashboard HTML Save Fix

## What changed
- Added an Admin-only HTML editor for the complete `user-dashboard.html` document.
- Added `GET /api/admin/site-files/user-dashboard` to load the current HTML.
- Added `PUT /api/admin/site-files/user-dashboard` to save HTML in MongoDB (`zanta_config`, key `userDashboardHtml`).
- Added `/user-dashboard.html` serving the saved MongoDB version, with `public/user-dashboard.html` as fallback.
- Increased Express JSON body limit to 250 KB so pasted HTML can be submitted safely.

## How to use
1. Replace the project files with this ZIP and redeploy/restart the bot.
2. Open the Admin page and sign in.
3. Find **User Dashboard HTML Editor**.
4. Tap **LOAD HTML** to retrieve the current file, or paste a complete HTML document including `<html>` and `</html>`.
5. Tap **SAVE user-dashboard.html** and wait for the success message.
6. Open `/user-dashboard.html` to view the saved version.

The save is stored in MongoDB, not only in browser local storage, so it persists through a restart or redeploy as long as the same MongoDB database is configured.
