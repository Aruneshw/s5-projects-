#!/usr/bin/env bash
# scripts/restore.sh <file.dump> <target-url> — restore into an EMPTY database.
set -euo pipefail
FILE="$1"; TARGET="$2"
N=$(psql "$TARGET" -At -c "select count(*) from information_schema.tables where table_schema='public'")
if [ "$N" -gt 0 ]; then echo "Target database is not empty. Restore only into a new, empty database." >&2; exit 1; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET" "$FILE"
psql "$TARGET" -At -c "select 'bills', count(*) from bills union all select 'ledger_entries', count(*) from ledger_entries"
echo "Restore finished."
