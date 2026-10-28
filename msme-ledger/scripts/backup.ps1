# scripts/backup.ps1 — full PostgreSQL backup (Windows PowerShell).
# Usage:  .\scripts\backup.ps1            (reads DATABASE_URL from .env)
# Needs the PostgreSQL client tools (pg_dump) on PATH.
$ErrorActionPreference = "Stop"
$envLine = Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $envLine) { throw "DATABASE_URL not found in .env" }
$url = ($envLine -replace '^DATABASE_URL=', '').Trim('"')
New-Item -ItemType Directory -Force -Path backups | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = "backups/msme-ledger-$stamp.dump"
pg_dump --format=custom --no-owner --no-privileges --file $file $url
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
pg_restore --list $file | Out-Null   # verifies the archive is readable
if ($LASTEXITCODE -ne 0) { throw "Backup verification failed" }
Write-Host "Backup written and verified: $file"
