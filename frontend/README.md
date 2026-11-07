npm in# Pendamping Pasien (VocaLine) · HTML + CSS + JS

Versi tanpa React: setiap halaman adalah file `.html` sendiri, gaya di file `.css`, logika di file `.js`.
Masih memakai Vite (untuk server lokal & build). Data memakai database tiruan di browser (`src/lib/mockDb.js`).

## Menjalankan

```
cd VocaLine
npm install
npm run dev
```

Buka http://localhost:5173

| Alamat | Isi | Akun demo |
| --- | --- | --- |
| `/login` | Login | — |
| `/nurse` | Dashboard perawat | sari@rumahsakit.id / rahasia123 (pilih **Admin**) |
| `/admin` | Panel superadmin | admin@rumahsakit.id / admin123 (pilih **Superadmin**) |
| `/tablet` | Tablet pasien (tanpa login) | — |

Tips demo: buka `/nurse` dan `/tablet` di dua tab. Tahan tombol DARURAT di tablet 1 detik, alarm muncul
di dashboard perawat. Di tablet, panel **Demo** (kiri bawah) untuk pindah layar; `?demo=0` menyembunyikannya,
`?bed=101a` memilih kasur. Reset data contoh: di console browser jalankan `ppResetDb()`.

## Mau ubah tampilan? Cari di sini

| Halaman | HTML | CSS halaman | JS halaman |
| --- | --- | --- | --- |
| Login | `login.html` | `src/apps/auth/pages/login.css` | `src/apps/auth/pages/login.js` |
| 403 / 404 | `403.html`, `index.html` | `src/apps/auth/pages/forbidden.css` | `src/apps/auth/pages/forbidden.js`, `home.js` |
| Dashboard perawat | `nurse.html` | `src/apps/nurse/pages/dashboard.css` | `src/apps/nurse/pages/dashboard.js` |
| Jadwal perawat | `nurse/schedule.html` | `src/apps/nurse/pages/schedule.css` | `src/apps/nurse/pages/schedule.js` |
| Ringkasan admin | `admin.html` | `src/apps/admin/pages/overview.css` | `src/apps/admin/pages/overview.js` |
| Pemasangan | `admin/setup.html` | `src/apps/admin/pages/setup.css` | `src/apps/admin/pages/setup.js` |
| Denah | `admin/layout.html` | `src/apps/admin/pages/layout.css` | `src/apps/admin/pages/layout.js` |
| Tablet (admin) | `admin/tablets.html` | `src/apps/admin/pages/tablets.css` | `src/apps/admin/pages/tablets.js` |
| Akun perawat | `admin/nurses.html` | `src/apps/admin/pages/nurses.css` | `src/apps/admin/pages/nurses.js` |
| Umur & eskalasi | `admin/settings.html` | `src/apps/admin/pages/settings.css` | `src/apps/admin/pages/settings.js` |
| Statistik | `admin/stats.html` | `src/apps/admin/pages/stats.css` | `src/apps/admin/pages/stats.js` |
| Tablet pasien | `tablet.html` | `src/apps/tablet/pages/<layar>.css` | `src/apps/tablet/tabletApp.js` + `pages/<layar>.js` |

Gaya yang dipakai lebih dari satu halaman:

| File | Isi |
| --- | --- |
| `src/styles/tokens.css` | **Warna tema, huruf, radius.** Ubah warna utama di sini. `.theme-admin` = warna superadmin. |
| `src/styles/base.css` | Teks, form, tabel, header & sidebar dashboard, toast |
| `src/styles/personas.css` | Ukuran huruf & tombol tablet per kelompok umur |
| `src/styles/components/btn.css` | Semua tombol, termasuk tombol DARURAT |
| `src/styles/components/modal.css` | Modal, laci samping, toast |
| `src/styles/components/bed.css` | Warna kasur & kamar di denah perawat |
| `src/styles/components/alarm-card.css` | Kartu alarm di antrean perawat |
| `src/apps/nurse/nurse.css` | Header perawat & modal akhiri shift |
| `src/apps/admin/admin.css` | Tabel, status tablet, baterai (semua halaman admin) |
| `src/apps/tablet/tablet.css` | Avatar AI, volume, overlay alarm & pengingat, panel demo |

`src/styles/main.css` memuat semua file di `src/styles/`, dan setiap `.html` memuat `main.css` lalu CSS halamannya.

## Cara kerjanya

- **Bagian yang tetap** (judul, form, tombol, kerangka tabel) ditulis langsung di file `.html`.
- **Bagian yang berubah menurut data** (denah kasur, kartu alarm, baris tabel, modal) dibuat oleh JS memakai
  `html\`...\`` dari `src/lib/dom.js`, lalu dipasang dengan `setHtml()`. Nama class di situ sama dengan di CSS.
- Header & sidebar dashboard diisi oleh `src/components/layout/shell.js`
  (perawat: `src/apps/nurse/components/nurseShell.js`, admin: `src/apps/admin/components/adminShell.js`).
- Data: `watchDb(fn)` dari `src/lib/realtime.js` memanggil `fn(db)` setiap data berubah, juga dari tab lain.

### Menambah halaman baru

1. Buat `nama.html` (salin halaman yang mirip), plus `src/apps/<app>/pages/nama.css` dan `nama.js`.
2. Daftarkan `'nama'` di array `pages` di `vite.config.js` supaya ikut di-build.
3. Tambahkan link di menu (`NAV` di `adminShell.js` atau `nav` di `nurseShell.js`).

## Struktur folder

```
VocaLine/
├─ index.html, login.html, 403.html, tablet.html, nurse.html, admin.html
├─ nurse/schedule.html
├─ admin/setup.html, layout.html, tablets.html, nurses.html, settings.html, stats.html
├─ public/                      manifest, ikon, suara
└─ src/
   ├─ styles/                   gaya bersama (lihat tabel di atas)
   ├─ lib/                      dom.js (alat HTML), mockDb, auth, realtime, guard, supabase
   ├─ store/                    sesi login, toast
   ├─ services/                 operasi data (alarm, pasien, kamar, tablet, ...)
   ├─ constants/, utils/        konstanta & fungsi kecil
   ├─ components/ui/            modal, laci, toast, tabs, switch
   ├─ components/layout/        header & sidebar dashboard
   └─ apps/
      ├─ auth/pages/            login, 403/404
      ├─ nurse/                 pages/, components/, logic/, nurse.css
      ├─ admin/                 pages/, components/, logic/, admin.css
      └─ tablet/                tabletApp.js, pages/, components/, logic/, personas/, services/, store/
```

Folder `hooks/` versi React sekarang bernama `logic/` (isinya fungsi JS biasa).

## Mode demo dan mode sungguhan

- **Demo** (`VITE_API_URL` kosong): data tiruan di localStorage, seperti di atas.
- **Sungguhan** (`VITE_API_URL` terisi, di Docker otomatis `/api`):
  - `src/lib/mockDb.js` memuat data dari backend (`GET /api/compat/snapshot`, tablet: `/api/compat/tablet-snapshot`)
    dengan bentuk yang sama, hanya di memori. Halaman tidak berubah.
  - `src/services/*.js` tetap mengubah data lokal (tampilan langsung berubah) lalu mengirim aksi ke backend.
  - `src/lib/realtime.js` memuat ulang data saat ada event SSE `GET /api/events` (dan berkala sebagai cadangan).
  - Login lewat `POST /api/auth/login` (backend self-hosted); undangan & reset kata sandi membuka
    `/auth/set-password#token=...`.
  - Tablet: `POST /api/tablet/register` → token perangkat + kode `VL-XXXX-XXXX`. Suara: `logic/speechToText.js`
    (rekam), `services/stt.js` (kirim ke backend), `logic/textToSpeech.js` (ucapkan). Alarm tombol yang gagal
    terkirim dikirim ulang otomatis tiap 5 detik.
- Deploy: container `web` (lihat `Dockerfile` dan `Caddyfile`, clean URLs seperti dulu di Vercel).
  Lokal: `npm run dev` (proxy `/api` ke `DEV_API_TARGET`, default `http://localhost:8080`).
- Id elemen mengikuti mockup (`app-`, `pt-`, `nr-`, `sa-`), daftar di `src/constants/elementIds.js`.
