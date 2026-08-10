#!/bin/bash
set -e
# This script lives at docker/setup.sh; docker-compose.yml is ONE level up,
# at the repo root. Compose reads `.env` from the directory containing
# docker-compose.yml (not from docker/), so `.env` is written to the PARENT
# of this script's own directory.
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
# İlk hesabın şifresi. hex, base64 değil: perl s/// ile yazıldığı için base64'ün
# "/" karakteri ayıracı bozardı. 24 hex karakter = 96 bit.
ADMIN_PASSWORD=$(openssl rand -hex 12)
perl -pi -e "s/^LEENAR_ADMIN_PASSWORD=\$/LEENAR_ADMIN_PASSWORD=${ADMIN_PASSWORD}/" "$ROOT/.env"
echo "✓ Admin hesabı: $(grep '^LEENAR_ADMIN_EMAIL=' .env.example | cut -d= -f2-) / ${ADMIN_PASSWORD}"
echo "✓ .env oluşturuldu (repo root). OPENAI_API_KEY'i .env içine ekle, sonra: docker compose up"
