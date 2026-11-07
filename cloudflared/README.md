# Cloudflare Tunnel

Dua cara, pilih salah satu. Cara A paling sederhana dan sudah disiapkan di `docker-compose.yml`.

## A. Tunnel dikelola dari dashboard (token) — DIREKOMENDASIKAN

1. Cloudflare Dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared.
2. Beri nama (mis. `vocaline`). Pada langkah instalasi, salin token panjang setelah `--token` ke `.env`:
   `TUNNEL_TOKEN=eyJ...`
3. Tab **Public Hostname** → Add:
   - Subdomain: `app`  · Domain: `domain-anda.id`
   - Service: **HTTP** · URL: **`web:80`**
4. `COMPOSE_PROFILES` di `.env` harus memuat `tunnel`, lalu `docker compose up -d`.

## B. Tunnel lokal dengan file konfigurasi (opsional)

Gunakan `config.yml.example` di folder ini jika ingin konfigurasi ingress di file, bukan di dashboard.
Lihat MIGRATION.md bagian 7B.
