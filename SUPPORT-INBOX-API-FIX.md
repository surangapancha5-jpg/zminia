# ZANTA-XMD OFC — Developer Support Inbox API Fix

## Fixed
- Backend explicitly registers `GET /api/admin/support`.
- The endpoint is protected by the existing admin-session middleware (`x-admin-token`).
- It returns `{ success, tickets, total }` from MongoDB collection `zanta_support_tickets`, newest first.
- Database failures return a JSON 500 response instead of an Express HTML error page.
- Frontend displays a clear deployment hint if the running server responds `Cannot GET /api/admin/support`.

## Important deployment steps
1. Extract this ZIP.
2. Replace the **entire existing bot project folder**, especially the root `web-dashboard.js` file (not just files inside `public/`).
3. Keep your existing hosting environment variables and MongoDB connection string.
4. Restart/redeploy the Node.js service so it loads the updated backend file.
5. Sign in to the Admin Panel again and press **REFRESH ALL**.

The `Cannot GET` response means the live Express process has not registered this route. If it still appears after replacing the root `web-dashboard.js` and restarting, the hosting service is running a different project directory or start command.
