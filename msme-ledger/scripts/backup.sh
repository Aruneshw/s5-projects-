#!/usr/bin/env bash
# scripts/backup.sh — full PostgreSQL backup (Linux/macOS). Usage: ./scripts/backup.sh
set -euo pipefail
URL=$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
mkdir -p backups
FILE="backups/msme-ledger-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file "$FILE" "$URL"
pg_restore --list "$FILE" > /dev/null   # verifies the archive is readable
echo "Backup written and verified: $FILE"
