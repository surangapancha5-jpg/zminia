# ZANTA-XMD OFC dashboard setup

1. Use Node.js 20+ and install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure `MONGODB_URI`, `ADMIN_EMAIL`, and a strong unique `ADMIN_PASSWORD` in your host's secret/environment settings.
3. Keep `.env` out of Git and never publish it. The uploaded `.env` file was deliberately excluded from this updated package because it contained live credentials/API keys.
4. Deploy the project and open `/` for registration/login.
5. The private owner console route is `/zanta-owner-console-7f3a`. Admin access is verified server-side; the route is not linked in the user interface.
6. Configure app entries as JSON objects, e.g. `[{"id":"app1","name":"Example App","price":200,"url":"https://example.com"}]`. App prices have a 200-coin minimum.
7. Configure the AI endpoint and key in the owner console. This package stores those settings privately in MongoDB; a provider-specific AI chat adapter still needs to be connected before the AI chat can make live requests.

## Important browser limitation
Web pages cannot enumerate the email accounts installed on a visitor's phone. This dashboard asks the visitor to type an email address. Browser security intentionally prevents a website from reading the phone's mail-account list. No email is sent or verified by this starter unless you add an email verification provider.

## Security notes
- Passwords are hashed with scrypt; sessions are stored as hashes in MongoDB and use HttpOnly cookies.
- Pairing is available only to authenticated users. Pairing codes are sensitive; users should only pair their own WhatsApp account.
- Daily rewards are granted once per UTC day, selected from 20, 30, 40, 50, 100, and 150 coins.
- Coins, notices, users, app unlocks, and configuration are stored in MongoDB.
- Configure a real email verification flow, rate limiting, CSRF protection, HTTPS, backups, and audit logs before public production use.


## Owner admin login
Set these environment variables in your hosting provider (do not put them in public HTML):

- `ADMIN_EMAIL=zantaxmd@gmail.com`
- `ADMIN_USERNAME=@devloper`
- `ADMIN_PASSWORD` = the owner password you chose (`suranga12345` if you are keeping the supplied password)

Redeploy/restart the Node.js service after saving the variables. At `/zanta-owner-console-7f3a`, sign in using either the email or `@devloper` plus the password. The admin session is stored in MongoDB.
