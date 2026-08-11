#!/bin/bash
set -e
# This script lives at docker/setup.sh; docker-compose.yml is ONE level up,
# at the repo root. Compose reads `.env` from the directory containing
# docker-compose.yml (not from docker/), so `.env` is written to the PARENT
# of this script's own directory.
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
if [ -f "$ROOT/.env" ]; then echo ".env already exists, leaving it alone."; exit 0; fi
cp .env.example "$ROOT/.env"
# Fill in the random secrets (portable between macOS and Linux):
for key in ENCRYPTION_KEY INTERNAL_SECRET STATE_SIGNING_SECRET REALTIME_SECRET_KEY_BASE; do
  val=$(openssl rand -hex 32)
  # replace the empty "KEY=" line
  perl -pi -e "s/^${key}=\$/${key}=${val}/" "$ROOT/.env"
done
# The first account's password. Hex rather than base64: it is written through
# perl s///, and base64's "/" character would break the delimiter. 24 hex
# characters = 96 bits.
ADMIN_PASSWORD=$(openssl rand -hex 12)
perl -pi -e "s/^LEENAR_ADMIN_PASSWORD=\$/LEENAR_ADMIN_PASSWORD=${ADMIN_PASSWORD}/" "$ROOT/.env"
echo "✓ Admin account: $(grep '^LEENAR_ADMIN_EMAIL=' .env.example | cut -d= -f2-) / ${ADMIN_PASSWORD}"
echo "✓ .env created (repo root). Add your OPENAI_API_KEY to it, then run: docker compose up"
