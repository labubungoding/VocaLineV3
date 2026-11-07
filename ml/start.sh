#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
TUNNEL="${1:-vine-ml}"

[ -x .venv/bin/python ] || { echo "[GAGAL] .venv belum ada. Jalankan: python -m venv .venv && pip install -r requirements.txt"; exit 1; }
[ -f .env ] || { echo "[GAGAL] .env belum ada. Salin dari .env.example lalu isi ML_API_KEY."; exit 1; }
grep -qE '^ML_API_KEY=.+' .env || { echo "[GAGAL] ML_API_KEY di .env masih kosong."; exit 1; }

echo "Menyalakan ml-service di http://127.0.0.1:8000 ..."
.venv/bin/python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

if [ "$TUNNEL" = "--lokal" ]; then
  echo "Mode lokal: buka http://127.0.0.1:8000/docs (Ctrl+C untuk berhenti)"
  wait $SERVER
  exit 0
fi

command -v cloudflared >/dev/null || { echo "[GAGAL] cloudflared belum terpasang. Atau jalankan: ./start.sh --lokal"; exit 1; }

echo "Menunggu server siap ..."
until curl -s http://127.0.0.1:8000/health >/dev/null; do sleep 3; done
echo "Server siap. Menyalakan tunnel \"$TUNNEL\" ..."
cloudflared tunnel run --url http://127.0.0.1:8000 "$TUNNEL"
