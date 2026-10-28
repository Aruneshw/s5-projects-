# Deployment and operations

## 1. Deploying (Vercel + managed PostgreSQL, e.g. Supabase or Neon)

1. Create a managed PostgreSQL database. Use its **direct (non-pooled) connection string** for migrations,
   and the pooled string (if offered) for the app. Supabase: Project → Connect.
2. Push the code to GitHub and import the repo in Vercel (framework: Next.js; build command `npm run build`).
3. Environment variables (Vercel → Settings → Environment Variables; separate values for Preview and Production):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | production connection string (`?sslmode=require`) |
   | `NEXTAUTH_URL` | `https://your-domain` |
   | `NEXTAUTH_SECRET` | new random 32-byte secret (never reuse the dev one) |
   | `CRON_SECRET` | new random secret |
   | `INACTIVITY_TIMEOUT_MINUTES`, `ABSOLUTE_SESSION_HOURS` | e.g. 30 and 12 |

   Never set `SEED_*` in production and never run `db:seed` there (it refuses when `NODE_ENV=production`).
4. Apply migrations **before** the new code goes live, from your PC:

   ```powershell
   $env:DATABASE_URL = "<production direct connection string>"; npx prisma migrate deploy; Remove-Item Env:DATABASE_URL
   ```
5. Create the business and its first owner (no demo data):

   ```powershell
   $env:DATABASE_URL = "<production connection string>"; $env:NEW_OWNER_PASSWORD = "<your password>"; $env:ALLOW_WEAK_PASSWORD = "1"  # only if the password is shorter than 8 characters
   npm run setup:owner -- "Your Business Name" zaids5 "Zaid"
   Remove-Item Env:DATABASE_URL, Env:NEW_OWNER_PASSWORD, Env:ALLOW_WEAK_PASSWORD
   ```
   Then sign in and add Dad (owner) and any cashier from **Team**.
6. `vercel.json` schedules `/api/jobs/daily` every day at 02:00 IST; Vercel sends `Authorization: Bearer $CRON_SECRET`.
   Other hosts: call it from any scheduler with that header, or run `npm run jobs:daily`.

## 2. Health checks

`GET /api/health` → `200 {"status":"ok","db":"ok","migrationsApplied":2}`; `503` when the database is unreachable.
Point your uptime monitor at it. After each deploy, check it and that `migrationsApplied` matches the number of
folders in `prisma/migrations`.

## 3. Backups — what is and is not automatic

* **Do not assume** your provider backs up a free-tier database. Check its current plan page: for example,
  Supabase documents daily backups only on paid plans (verify at https://supabase.com/docs/guides/platform/backups
  before relying on it).
* **Your own backup (recommended daily):** `.\scripts\backup.ps1` (or `./scripts/backup.sh`) runs `pg_dump` in custom
  format to `backups/` and verifies the archive is readable with `pg_restore --list`. Copy the file off the machine
  (Google Drive, a USB disk). Keep at least 7 daily + 4 weekly copies.
* **Per-business export:** Settings → Backup → "Download data export (JSON)" (owners only; excludes password hashes,
  reset tokens and bank account numbers).

### Restore (practice this once!)

1. Create a **new, empty** database (never restore over the live one).
2. `.\scripts\restore.ps1 -File backups\msme-ledger-YYYYMMDD-HHMMSS.dump -TargetUrl "postgresql://msme:…@localhost:5432/msme_restore"`
3. The script refuses non-empty targets and prints bill / ledger counts. Compare them with the live app, then point
   `DATABASE_URL` at the restored DB only if everything matches.

The automated test `exports-backup.test.ts` performs a real `pg_dump → pg_restore` round trip and checks that ledger
totals and the immutability triggers survive.

## 4. Rollback

* **Code:** Vercel → Deployments → previous deployment → "Promote to Production". Safe as long as no migration was
  applied that the old code cannot handle.
* **Migrations are forward-only.** Never edit an applied migration and never change production data by hand.
  To undo a schema change, write a new migration that reverses it, test it on a copy (restore a backup into staging),
  then deploy.
* **Data mistakes** are fixed through the app's own tools (cancel bill, cancel payment, adjustments), which keep a
  full audit trail. The database itself blocks edits/deletes of posted financial records.

## 5. Routine checks

| When | Check |
|---|---|
| Daily | `/api/health` OK; backup file created; Sync screen has no "need attention" items |
| Weekly | Inventory → Reconciliation (oversold batches), overdue customers, audit log skim |
| Monthly | `npm audit --omit=dev`; update patch versions on a branch, run all tests, deploy |
| Year end | Settings → Financial years → Close year (after 31 March) and export reports for your CA |

## 6. Data retention

* OCR upload files: deleted 90 days after upload (`OCR_RETENTION_DAYS`), metadata kept.
* Rate-limit rows: deleted after 7 days.
* Financial records, audit log: kept indefinitely (Indian law requires books to be retained for several years —
  confirm the period with your CA).
