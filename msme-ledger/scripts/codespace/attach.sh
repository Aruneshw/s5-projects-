#!/usr/bin/env bash
# scripts/codespace/attach.sh — runs when you open the codespace: creates the zaids5 login the
# first time (asks for its password here, so it is never stored in the repository).
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

USERNAME="zaids5"
EXISTS=$(psql "$DATABASE_URL" -At -c "select count(*) from users where username = '${USERNAME}'")
if [ "$EXISTS" = "0" ]; then
  if [ -t 0 ]; then
    echo "First run: create the login for ${USERNAME}."
    read -rp "Business name [My Business]: " ORG
    read -rsp "Password for ${USERNAME}: " PW; echo
    NEW_OWNER_PASSWORD="$PW" ALLOW_WEAK_PASSWORD=1 npm run --silent setup:owner -- "${ORG:-My Business}" "$USERNAME" "Zaid"
  else
    echo "Login not created yet. Open a terminal and run:  bash scripts/codespace/attach.sh"
    exit 0
  fi
fi
echo "Open the app: ${NEXTAUTH_URL}  — sign in as ${USERNAME}"
