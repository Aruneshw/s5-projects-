# MSME Ledger

**MSME Digital Accounting Ledger with Automated Micro-Invoice Discounting and Working Capital Credit Matchmaker** —
a mobile-first, offline-capable web app for a family vegetable wholesale business trading between Tamil Nadu and Kerala.

* Purchase & sales bills with **bag-by-bag weighing** (70 + 80 → 2 bags, 150 kg), per-bag coolie on sales, less/bonus with reasons
* Ledger as the single source of truth for balances; payments (cash, UPI, bank…) partial and idempotent
* Sales-to-purchase traceability with real item margins (hidden by default), stock in/out, over-sell protection
* Expenses and worker salaries, daily and financial reports, tax summary for your CA, CSV/XLSX/PDF exports
* Works offline at the market: drafts and a sync queue on each phone, conflict handling that never loses data
* Bill PDFs, WhatsApp sharing, purchase-bill OCR with mandatory review, backups
* Trust score, invoice-discounting workflow with real financiers, indicative loan matchmaking
* Roles: owner (Me, Dad), cashier, investor, lender — enforced on the server and in the database

| Read | For |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Install and run on Windows (PowerShell) / Linux / macOS |
| [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md) | Every formula, rounding rule, the design audit and 3 worked examples |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Verified stack versions, structure, data model, roles, sync protocol |
| [docs/API.md](docs/API.md) | Every endpoint: method, path, permission, schema, errors, transactions |
| [docs/SECURITY.md](docs/SECURITY.md) | Security checklist with verification status |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deployment, health checks, backups/restore, rollback |
| [docs/PHASES.md](docs/PHASES.md) | What was built in each of the 10 phases, what was tested, limitations |

Quick start (after installing Node 24 and PostgreSQL — details in SETUP.md):

```powershell
Copy-Item .env.example .env   # then edit .env (database URL, secrets)
npm ci
npx prisma migrate deploy
npm run db:seed
npm run dev                   # http://localhost:3000  → sign in as "zaids5"
```

This app is a record-keeping and workflow tool. It is not a lender and not a substitute for a Chartered Accountant.
