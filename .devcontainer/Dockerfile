FROM mcr.microsoft.com/devcontainers/javascript-node:1-24-bookworm
# psql / pg_dump for the setup scripts and scripts/backup.sh.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
