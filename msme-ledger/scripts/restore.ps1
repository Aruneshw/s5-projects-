# scripts/restore.ps1 — restore a backup into an EMPTY database (never over production by accident).
# Usage:  .\scripts\restore.ps1 -File backups\msme-ledger-YYYYMMDD-HHMMSS.dump -TargetUrl "postgresql://user:pass@host:5432/empty_db"
param([Parameter(Mandatory = $true)][string]$File, [Parameter(Mandatory = $true)][string]$TargetUrl)
$ErrorActionPreference = "Stop"
$tables = psql $TargetUrl -At -c "select count(*) from information_schema.tables where table_schema='public'"
if ([int]$tables -gt 0) { throw "Target database is not empty. Restore only into a new, empty database." }
pg_restore --no-owner --no-privileges --exit-on-error --dbname $TargetUrl $File
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
psql $TargetUrl -At -c "select count(*) as bills from bills; select count(*) as ledger from ledger_entries;"
Write-Host "Restore finished. Point DATABASE_URL at the restored database only after checking the counts above."
