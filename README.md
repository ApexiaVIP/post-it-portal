# POST IT Portal 

Simple password-protected web app for the team to enter POST IT manual data
(UCF, CF, ORPHANS, TQ Comp, Fact Find, Quotes, Closes, Declines, Postpones,
Acc, Ref — plus Ric's Customer Service row). Data is stored in Vercel KV and
fetched by the `post-it-automation` GitHub Action on each scheduled run and
merged into the emailed POST IT workbook. 

## Deploy to Vercel

1. Push this folder to a **new private GitHub repo** (e.g. `post-it-portal`).
2. In Vercel: **Add New → Project → Import Git Repository** → pick the repo.
3. Framework preset: Next.js (auto-detected).
4. Before clicking **Deploy**, click **Environment Variables** and add the
   values listed in `.env.example`. Guidance:
   - `SESSION_PASSWORD` — random 48-char string (run
     `openssl rand -base64 36` or use a password generator).
   - `ADMIN1_USERNAME` / `ADMIN2_USERNAME` — the usernames you want.
   - `ADMIN1_PASSWORD_HASH` / `ADMIN2_PASSWORD_HASH` — bcrypt hash of each
     password. Generate locally with:

     ```bash
     npx bcryptjs-cli hash yourpassword
     # or:
     node -e "console.log(require('bcryptjs').hashSync('yourpassword', 10))"
     ```

   - `READ_API_TOKEN` — another random 48-char string. GitHub Actions will
     use this to fetch `/api/latest`.
5. Click **Deploy**. Takes ~1 minute.
6. After the first deploy, go to **Storage → Create Database → KV**, attach
   it to this project. Vercel injects `KV_REST_API_*` env vars automatically.
   **Redeploy** to pick them up.

## Integrating with `post-it-automation`

Add to the repo's **Settings → Secrets → Actions**:
- `PORTAL_URL`       — e.g. `https://post-it-portal.vercel.app`
- `PORTAL_API_TOKEN` — same string as `READ_API_TOKEN` above

The scraper (updated) will hit `${PORTAL_URL}/api/latest` with
`Authorization: Bearer ${PORTAL_API_TOKEN}` and merge the payload into the
emailed workbook.

## Local dev

```bash
npm install
cp .env.example .env.local
# fill in at minimum SESSION_PASSWORD, ADMIN1_*, READ_API_TOKEN
npm run dev
```

With no KV vars set, data is stored in memory (wiped on server restart). Fine
for UI testing.

## Security notes

- Passwords are bcrypt-hashed — plaintext never stored or transmitted beyond
  the login POST.
- Session cookie is HttpOnly + Secure + SameSite=Lax, 7-day lifetime.
- `/api/latest` is protected by a Bearer token (`READ_API_TOKEN`). Never
  commit it; only Vercel + GitHub Actions secrets see it.
