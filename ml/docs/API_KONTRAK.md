# Kontrak API ml-service

Dokumen ini mencatat kontrak endpoint yang dipakai frontend/backend. Alur lengkap dan endpoint lain (`/process-audio`,
`/converse-stream`, `/greeting`, `/reminder`, `/reset-session`) ada di `README.md` dan `docs/integrasi.md`.

Semua endpoint kecuali `/health` wajib membawa header `X-API-Key` (sama dengan `ML_API_KEY` di `.env`).
Kunci ini hanya disimpan Edge Function, **tidak pernah** di tablet atau di kode frontend.

| Kode | Arti |
| --- | --- |
| 401 | `X-API-Key` salah atau tidak ada |
| 503 | `ML_API_KEY` belum diisi di server |

---

## `GET /pengaturan-suara`

Semua angka suara Vine dan VAD (deteksi bicara) untuk frontend, dari `config/suara.yaml`.
**Frontend wajib memuat pengaturan dari endpoint ini saat start** (saat aplikasi tablet dibuka / sesi pasien
dimulai) dan tidak boleh menulis angka suara/VAD sendiri. Cara memakainya: `docs/PANDUAN_FRONTEND.md`.

- Header: `X-API-Key` (lewat Edge Function, lihat di atas)
- Body: tidak ada
- Dibaca ulang dari file setiap permintaan: perubahan `config/suara.yaml` langsung berlaku di start berikutnya,
  server tidak perlu dinyalakan ulang.

### Jawaban 200

```json
{
  "ekspresi": {"senang": {"pitch": 1.15, "rate": 1.05}, "netral": {"pitch": 1.0, "rate": 1.0}, "...": {}},
  "persona": {"remaja": {"pitch": 0.05, "rate": 1.0}, "dewasa": {"pitch": 0.0, "rate": 1.0},
              "lansia": {"pitch": -0.05, "rate": 0.95}},
  "batas": {"rate": {"min": 0.5, "maks": 2.0}, "pitch": {"min": 0.0, "maks": 2.0}},
  "vad": {
    "diam_selesai_ms": {"remaja": 1000, "dewasa": 1200, "lansia": 1600},
    "diam_manual_ms": {"min": 300, "maks": 3000, "langkah": 100},
    "min_bicara_ms": 400,
    "pad_awal_ms": 300,
    "ambang_bicara": 0.5,
    "selisih_ambang_diam": 0.15,
    "ambang_diam_min": 0.05,
    "barge_in_ms": 300,
    "ambang_barge_in": 0.8,
    "laju_sampel_hz": 16000
  },
  "filler": {"filler_ms": 700, "ekspresi": "netral",
             "kalimat": {"remaja": ["Hmm...", "..."], "dewasa": ["..."], "lansia": ["Iya, {sapaan}...", "..."]}},
  "mesin_suara": {"jeda_setelah_batal_ms": 350, "batas_macet_ms": 5000, "periksa_ms": 100},
  "perintah_suara": {"volume_awal": 1.0, "volume_langkah": 0.3, "volume_min": 0.2, "volume_maks": 1.0,
                     "kecepatan_awal": 1.0, "kecepatan_langkah": 0.15, "kecepatan_min": 0.6},
  "rekaman": {"min_ukuran_byte": 2000},
  "kecepatan_persona": {"remaja": 1.05, "dewasa": 1.0, "lansia": 0.85}
}
```

Nilai di atas adalah nilai saat dokumen ini ditulis. Selalu pakai nilai dari jawaban, bukan dari dokumen ini.

| Field | Arti |
| --- | --- |
| `ekspresi.<ekspresi>.pitch/rate` | Nada dan pengali kecepatan per ekspresi Vine (`senang`, `antusias`, `empati`, `tenang`, `bercanda`, `serius`, `netral`) |
| `persona.<persona>.pitch/rate` | Penyesuaian nada (ditambah) dan kecepatan (dikali) per persona |
| `batas.rate`, `batas.pitch` | Batas akhir rate/pitch setelah rumus |
| `vad.diam_selesai_ms.<persona>` | Diam selama ini setelah pasien bicara = selesai bicara (`redemptionMs` di vad-web) |
| `vad.diam_manual_ms` | Rentang isian manual diam (hanya halaman uji) |
| `vad.min_bicara_ms` | Suara lebih pendek diabaikan (batuk, "eh") (`minSpeechMs`) |
| `vad.pad_awal_ms` | Audio sebelum awal bicara yang ikut dikirim (`preSpeechPadMs`) |
| `vad.ambang_bicara` | Peluang bicara untuk mulai bicara (`positiveSpeechThreshold`) |
| `vad.selisih_ambang_diam`, `vad.ambang_diam_min` | `negativeSpeechThreshold = max(ambang_diam_min, ambang_bicara - selisih_ambang_diam)` |
| `vad.barge_in_ms`, `vad.ambang_barge_in` | Pasien memotong Vine jika bicara terus-menerus selama `barge_in_ms` dengan peluang >= `ambang_barge_in` |
| `vad.laju_sampel_hz` | Laju sampel audio yang dikirim ke server. Selalu 16000 (ditentukan model) |
| `filler.filler_ms` | Filler diucapkan jika kalimat pertama belum tiba selama ini setelah pasien selesai bicara |
| `filler.ekspresi`, `filler.kalimat.<persona>` | Ekspresi dan pilihan kalimat filler (`{sapaan}` = "Pak", "Bu", ...) |
| `mesin_suara.jeda_setelah_batal_ms` | Tunda `speak()` selama ini setelah `cancel()` (mesin suara browser bisa macet) |
| `mesin_suara.batas_macet_ms` | Ucapan terdepan belum berbunyi selama ini = mesin suara macet, ulangi antrian |
| `mesin_suara.periksa_ms` | Interval pemeriksaan mesin suara |
| `perintah_suara.*` | Nilai awal dan langkah untuk perintah "kecilkan/besarkan suara", "bicara pelan-pelan" |
| `rekaman.min_ukuran_byte` | Rekaman tombol bicara yang lebih kecil dianggap terlalu pendek |
| `kecepatan_persona.<persona>` | Kecepatan dasar per persona (sama dengan `kecepatan_bicara` di jawaban lain), untuk filler/tombol darurat sebelum server menjawab |

### Galat

| Kode | Arti | Yang dilakukan frontend |
| --- | --- | --- |
| 401 / 503 | Kunci salah / belum diisi | Tampilkan galat konfigurasi |
| 500 | `config/suara.yaml` rusak (`detail` menyebut bagian yang salah) | Pakai pengaturan terakhir yang berhasil dimuat (lihat panduan frontend) |
