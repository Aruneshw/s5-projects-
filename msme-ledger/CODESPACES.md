# Running MSME Ledger in GitHub Codespaces

Only a GitHub account is needed. The app and its own PostgreSQL database run inside the codespace.

## First time
1. On GitHub, open this repository → green **Code** button → **Codespaces** tab → **Create codespace**.
2. Wait for setup to finish (first time ≈ 5 minutes: install, database, build).
3. The terminal asks two questions, once:
   * **Business name** — press Enter for "My Business".
   * **Password for zaids5** — type your password (nothing shows while typing) and press Enter.
4. Open the **Ports** tab → port **3000** → click the globe icon. Sign in as **zaids5**.

If the terminal says "Login not created yet", run `bash scripts/codespace/attach.sh` in the terminal.

## Every time after
Open github.com/codespaces → click your codespace. The app starts automatically; open port 3000 again.

## Good to know
* The codespace stops after 30 minutes without use; your data is kept. Reopen it to use the app again.
* Free plan: about 60 hours a month. Deleting the codespace **deletes the data** — download a backup first
  (Settings → Backup in the app, or `bash scripts/backup.sh` in the terminal).
* The address is private (only your GitHub account can open it). To use it from another phone or person,
  Ports tab → right-click port 3000 → **Port Visibility → Public**; then anyone with the link sees the login page.
* App log: `tail -f /tmp/msme-ledger.log`. Restart the app: `bash scripts/codespace/start.sh`.
