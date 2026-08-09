#!/bin/bash
set -e
# SHIPPED (core repo) layout: this script lives at docker/setup.sh;
# docker-compose.yml is ONE level up, at the repo root. Compose reads `.env`
# from the directory containing docker-compose.yml (not from docker/), so
# `.env` is written to the PARENT of this script's own directory. This
# differs from the monorepo dev copy (scripts/open-core/docker/setup.sh),
# where docker-compose.yml and setup.sh are SIBLINGS (both directly under
# scripts/open-core/docker/) and `.env` is written alongside setup.sh itself
# — keep both in sync by hand when editing.
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
if [ -f "$ROOT/.env" ]; then echo ".env zaten var, atlanıyor."; exit 0; fi
cp .env.example "$ROOT/.env"
# Rastgele secret'ları doldur (macOS/Linux sed uyumlu):
for key in ENCRYPTION_KEY INTERNAL_SECRET STATE_SIGNING_SECRET REALTIME_SECRET_KEY_BASE; do
  val=$(openssl rand -hex 32)
  # boş "KEY=" satırını doldur
  perl -pi -e "s/^${key}=\$/${key}=${val}/" "$ROOT/.env"
done
echo "✓ .env oluşturuldu (repo root). OPENAI_API_KEY'i .env içine ekle, sonra: docker compose up"
