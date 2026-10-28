#!/usr/bin/env bash
# scripts/codespace/start.sh — runs every time the codespace starts: writes .env, applies
# migrations, builds if needed and starts the app on port 3000 in the background.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_URL="postgresql://msme:msme@db:5432/msme_ledger"
if [ -n "${CODESPACE_NAME:-}" ]; then
  APP_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  APP_URL="http://localhost:3000"
fi

if [ ! -f .env ]; then
  secret() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
  cat > .env <<ENV
DATABASE_URL="${DB_URL}"
NEXTAUTH_SECRET="$(secret)"
CRON_SECRET="$(secret)"
NEXTAUTH_URL="${APP_URL}"
INACTIVITY_TIMEOUT_MINUTES="30"
ABSOLUTE_SESSION_HOURS="12"
ENV
  echo "Created .env"
fi

until pg_isready -q -h db -U msme; do echo "Waiting for the database…"; sleep 1; done
npx prisma migrate deploy

# Rebuild when the code changed since the last build.
REV="$(git rev-parse HEAD 2>/dev/null || echo none)"
if [ ! -f .next/BUILD_ID ] || [ "$(cat .next/.built-rev 2>/dev/null)" != "$REV" ]; then
  npm run build
  echo "$REV" > .next/.built-rev
fi

if ! curl -fs -o /dev/null http://localhost:3000/api/health; then
  nohup npm start > /tmp/msme-ledger.log 2>&1 &
  echo "App starting at ${APP_URL} (log: /tmp/msme-ledger.log)"
fi
