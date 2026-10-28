# Local setup (Windows PowerShell first; Linux/macOS notes inline)

You need: **Node.js 24 LTS**, **PostgreSQL 16 or 17**, and Git (optional). About 15 minutes.

## 1. Install the tools

1. Node.js 24 LTS: download the Windows installer from https://nodejs.org (choose "LTS"). Then check:

   ```powershell
   node -v      # should print v24.x.x
   npm -v
   ```

2. PostgreSQL: download the Windows installer from https://www.postgresql.org/download/windows/ .
   During install remember the password you set for the `postgres` user, keep port 5432, and tick
   "Command Line Tools". Add `C:\Program Files\PostgreSQL\17\bin` to your PATH if `psql --version` is not found.
   (macOS: `brew install postgresql@17`; Ubuntu: `sudo apt install postgresql`.)

## 2. Create the databases

`psql` is PostgreSQL's command-line tool. This creates a login for the app and two databases —
one for real use, one that the automated tests are allowed to wipe.

```powershell
psql -U postgres -h localhost
```

Inside psql (pick your own password instead of `change-me-123`):

```sql
CREATE ROLE msme WITH LOGIN PASSWORD 'change-me-123' CREATEDB;
CREATE DATABASE msme_ledger OWNER msme;
CREATE DATABASE msme_ledger_test OWNER msme;
\q
```

(`CREATEDB` lets the backup/restore test create a temporary database.)

## 3. Get the code and install packages

```powershell
cd C:\Projects            # any folder
Expand-Archive msme-ledger.zip -DestinationPath .   # or git clone …
cd msme-ledger
Copy-Item .env.example .env   # create your settings file first (edited in step 4)
npm ci                        # installs the exact pinned versions; also runs "prisma generate"
```

`npm ci` downloads Prisma's schema engine for your OS the first time — it needs internet.

## 4. Configure

```powershell
notepad .env
```

Fill in:

* `DATABASE_URL` / `TEST_DATABASE_URL` with your password, e.g.
  `postgresql://msme:change-me-123@localhost:5432/msme_ledger`
* `NEXTAUTH_SECRET` and `CRON_SECRET`: generate each with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
* `SEED_*_PASSWORD`: passwords for the demo users (development only).

(Linux/macOS: `cp .env.example .env` and edit with any editor.)

## 5. Create the tables and load demo data

```powershell
npx prisma migrate deploy          # applies prisma/migrations to DATABASE_URL
npm run db:seed                    # fictional demo business: Me, Dad, cashier, suppliers, customers, bills
```

To apply migrations to the TEST database too:

```powershell
$env:DATABASE_URL = "postgresql://msme:change-me-123@localhost:5432/msme_ledger_test"; npx prisma migrate deploy; Remove-Item Env:DATABASE_URL
```

(bash: `DATABASE_URL=postgresql://…/msme_ledger_test npx prisma migrate deploy`)

## 6. Run

```powershell
npm run dev          # http://localhost:3000  (development, hot reload)
```

Sign in as `zaids5` (or `dad`) with `SEED_OWNER_PASSWORD` / `SEED_DAD_PASSWORD`, or `cashier` to see the restricted view.
`investor` and `lender` (password `SEED_OWNER_PASSWORD`) show the financier portals.

To use it on your phone on the same Wi-Fi: find your PC's IP with `ipconfig`, then open `http://<ip>:3000`.
Installing as an app and the offline service worker need HTTPS or `localhost` — use the production build
(`npm run build; npm run start`) behind HTTPS when deployed (see OPERATIONS.md).

## 7. Check everything works

```powershell
npm run typecheck     # TypeScript strict: no output = pass
npm run lint          # ESLint: no output = pass
npm test              # unit + integration tests (needs TEST_DATABASE_URL migrated)
npm run build         # production build
npm run start         # serve the build on :3000 (keep this running)
npm run test:e2e      # in a second terminal; first time: npx playwright install chromium
```

Expected: `Tests 119 passed`, and `4 passed` for Playwright.

## 8. Everyday commands

| Task | Command |
|---|---|
| Start for development | `npm run dev` |
| New migration after editing `schema.prisma` | `npx prisma migrate dev --name what_changed` |
| Wipe the dev DB and re-seed | `npm run db:reset` |
| Back up the database | `.\scripts\backup.ps1` (Linux/macOS `./scripts/backup.sh`) |
| Run daily jobs by hand | `npm run jobs:daily` |
| Emergency password reset (server) | `npm run user:reset-password -- dad` |
