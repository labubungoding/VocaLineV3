# ml-service · Vine

Layanan machine learning untuk Vine, AI pendamping pasien rawat inap. Edge Function (Supabase) mengirim suara pasien ke layanan ini, lalu layanan ini mengembalikan teks balasan, level alarm, emosi pasien, dan (opsional) suara Vine dalam format JSON.

Layanan ini **langsung bisa dijalankan**. Model pembanding sudah terlatih dan ikut di folder `models/`, jadi alarm dan emosi sudah bekerja sebelum IndoBERT dilatih. Selama kunci Gemini kosong, Vine memakai balasan template yang mengikuti persona.

## Alur

```
audio (base64) → Silero VAD (potong hening) → Whisper (Groq, cadangan lokal) → cek keyakinan
                                          ├─ rendah → tanya ulang (maks 2x), atau alarm dulu jika ada tanda darurat
                                          └─ cukup  → aturan kata darurat + model maksud  → level alarm lokal
                                                      model emosi + kata emosi + nada suara (dibanding biasanya)
                                                        + perataan 3 kalimat (emosi sangat jelas langsung) → emosi + visual Vine
                                                      perintah perangkat? → jawab langsung tanpa Gemini
                                                      LLM (Groq → Gemini → template): balasan + level cadangan (hanya boleh menaikkan)
                                                      guardrails saran medis → TTS (opsional) → JSON
```

## Model yang dipakai

| Model | Tugas | Berjalan di | File |
| --- | --- | --- | --- |
| Aturan kata darurat | Jaring pengaman alarm merah | ml-service | `config/thresholds.yaml` |
| IndoBERT maksud (buatan sendiri) | darurat, bantuan, pertanyaan_medis, perintah, ngobrol | ml-service, CPU | `models/indobert-intent/` (dilatih di Colab) |
| IndoBERT emosi (buatan sendiri) | ceria, sedih, marah, netral | ml-service, CPU | `models/indobert-emotion/` (dilatih di Colab) |
| Model pembanding (buatan sendiri) | Cadangan dan patokan akurasi untuk kedua tugas di atas | ml-service, CPU | `models/baseline-*.joblib` (sudah ada) |
| Wake word (buatan sendiri) | "Vine on" dan "Vine off" | Browser tablet | lihat `training/train_wakeword.py` |
| Silero VAD | Deteksi ada ucapan | ml-service | otomatis |
| Groq Whisper `whisper-large-v3-turbo` | Suara ke teks (utama) | Server Groq | `GROQ_API_KEY` di `.env` |
| Whisper small/base (faster-whisper) | Suara ke teks (cadangan, atau utama jika `STT_PROVIDER=lokal`) | ml-service, CPU | otomatis diunduh saat pertama dipakai |
| Groq LLM (`openai/gpt-oss-20b`, `qwen/qwen3.8-27b`) | Balasan percakapan + level cadangan (utama) | Server Groq | `GROQ_API_KEY` di `.env` |
| Gemini tier gratis | Balasan percakapan + level cadangan (cadangan Groq) | Server Google | kunci di `.env` |
| Web Speech API / Piper / MMS | Suara Vine | Browser atau ml-service | `TTS_PROVIDER` di `.env` |

Server otomatis memilih model maksud dan emosi dengan urutan: **IndoBERT → pembanding → kata kunci**. Cek yang aktif di `/health`.

Akurasi terukur dan perkiraan ada di [`docs/laporan_akurasi.md`](docs/laporan_akurasi.md). Ringkasnya, model pembanding mencapai 86,7% (maksud) dan 76,4% (emosi) pada cross-validation. IndoBERT diperkirakan 88–94% dan 78–86%.

## Instalasi (laptop)

Butuh Python 3.10 sampai 3.12.

```bash
python -m venv .venv
.venv\Scripts\activate                 # Linux/Mac: source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
copy .env.example .env                  # Linux/Mac: cp .env.example .env
```

Isi `.env`:
- `ML_API_KEY`: kunci rahasia yang juga disimpan tim backend di Edge Function. Wajib.
- `GROQ_API_KEY`: kunci dari console.groq.com. Dipakai untuk Whisper dan LLM di Groq.
- `GEMINI_API_KEY`: kunci dari Google AI Studio. Pakai kunci khusus demo yang terpisah dari testing.
- `STT_PROVIDER` dan `LLM_PROVIDER`: lihat bagian Penyedia STT/LLM.
- `WHISPER_MODEL`: `small` untuk RAM 16 GB, `base` untuk RAM 8 GB.
- `TTS_PROVIDER`: `browser` (default), `piper`, atau `mms`. Lihat bagian Suara Vine.

Model pembanding dilatih dengan scikit-learn versi tertentu. Kalau saat start muncul peringatan `pembanding_gagal_dimuat`, latih ulang di laptop (beberapa detik):

```bash
python training/prepare_data.py --task intent
python training/prepare_data.py --task emotion
python training/train_baseline.py
```

## Menjalankan

Paling mudah, pakai skrip start (menyalakan server, menunggu siap, lalu menyalakan tunnel):

```bash
start.bat              # Windows
start.bat --lokal      # Windows, tanpa tunnel
./start.sh             # Linux/Mac
```

Atau manual:

```bash
uvicorn src.api.main:app --host 127.0.0.1 --port 8000
```

Buka `http://localhost:8000/health` untuk status, dan `http://localhost:8000/docs` untuk mencoba semua endpoint dari browser.

## Mencoba ngobrol dengan Vine (halaman uji)

Setelah server menyala, buka `http://127.0.0.1:8000/demo` di Chrome atau Edge di laptop yang sama. Isi `ML_API_KEY`, nama panggilan, dan umur, lalu tekan **Mulai sesi**: Vine menyapa lebih dulu. Tekan **Tekan untuk bicara**, ucapkan kalimat, tekan lagi untuk mengirim. Vine menjawab dengan suara, dan halaman menampilkan maksud, level alarm, emosi, keyakinan Whisper, serta waktu proses. Kalimat juga bisa diketik.

Mikrofon hanya diizinkan browser di `127.0.0.1` atau `localhost` (atau HTTPS). Matikan halaman ini dengan `VINE_DEMO_PAGE=0` di `.env` jika server dibuka ke publik.

## Endpoint

Semua POST wajib header `X-API-Key`.

| Method | Path | Dipanggil oleh | Fungsi |
| --- | --- | --- | --- |
| GET | `/health` | siapa saja | Status komponen dan model yang aktif |
| POST | `/process-audio` | Edge Function, setiap pasien bicara | Endpoint utama sesuai kontrak data |
| POST | `/process-text` | Testing | Sama, tapi menerima teks |
| POST | `/converse-stream` | Edge Function / tablet (baru) | Sama dengan `/process-audio` (atau teks), tapi dibalas **per event**: alarm dulu, lalu balasan per kalimat |
| POST | `/greeting` | Backend, saat perawat menekan Aktifkan tablet | Sapaan pertama Vine. Menghapus sesi lama di kasur itu |
| POST | `/reminder` | Backend (pg_cron), saat jam pengingat tiba | Pengingat makan atau kunjungan dokter |
| POST | `/reset-session` | Backend, saat Pasien pulang | Menghapus riwayat obrolan kasur itu |
| GET | `/pengaturan-suara` | Tablet (lewat Edge Function) dan `/demo`, **saat start** | Semua angka suara/VAD dari `config/suara.yaml` (diam akhir bicara per persona, barge-in, filler, pitch/rate). Lihat `docs/API_KONTRAK.md`, `docs/PANDUAN_FRONTEND.md` |

Contoh permintaan `/process-audio`:

```json
{
  "id_kasur": "B2-204-1",
  "audio": "<base64 WAV, atau WebM/Opus langsung dari MediaRecorder>",
  "umur": 68,
  "nama_panggilan": "Pak Yusuf",
  "persona": "lansia",
  "jumlah_tanya_ulang": 0
}
```

Contoh jawaban:

```json
{
  "teks_pasien": "dada saya sakit sekali",
  "skor_keyakinan": 0.91,
  "maksud": "darurat",
  "level_alarm": "merah",
  "ringkasan_alarm": "Pasien mengeluh sakit dada",
  "emosi": "sedih",
  "visual_vine": "biru",
  "balasan_teks": "Perawat sedang menuju ke sini, Pak Yusuf.",
  "perlu_tanya_ulang": false,
  "perintah": null,
  "sumber_balasan": "groq",
  "waktu_proses_ms": 1840,
  "kecepatan_bicara": 0.85,
  "balasan_audio": null,
  "waktu": {"stt_ms": 610, "nlu_ms": 45, "llm_pertama_ms": 1120, "llm_ms": 1120, "total_ms": 1840},
  "penyedia": {"stt": "groq", "llm": "groq:openai/gpt-oss-20b"}
}
```

Format audio: WAV, WebM/Opus, Ogg, atau MP3. Frontend boleh langsung mengirim hasil `MediaRecorder` browser tanpa konversi. Boleh juga dengan awalan data URL (`data:audio/webm;base64,...`).

Field untuk frontend:
- `perlu_tanya_ulang: true` → frontend menaikkan `jumlah_tanya_ulang` di permintaan berikutnya. Kembalikan ke 0 setelah jawaban normal.
- `perintah` → `vine_off`, `vine_on`, `volume_turun`, `volume_naik`, `bicara_pelan`, `ulangi`, `diam`.
- `kecepatan_bicara` → dipakai sebagai `utterance.rate` di Web Speech API. Lansia 0,85.
- `balasan_audio` → WAV base64 jika TTS di server aktif. Jika `null`, tablet membacakan `balasan_teks`.
- `maksud` bisa juga `tidak_jelas` atau `tidak_ada_ucapan` (tidak perlu ditampilkan).

## Gaya bicara, ekspresi, dan memori

Prompt LLM disusun ringkas (sekitar 290–380 token, sebelumnya sekitar 880) oleh `src/conversation/prompt_builder.py` dari:
- `config/gaya_bicara.yaml`: aturan inti, cara memanggil per persona, aturan perawat, dan matriks **persona × emosi** (nada, contoh pembuka, yang dihindari). **Ubah teks balasan Vine di sini**, tanpa mengubah kode.
- `data/persona/*.jsonl`: contoh gaya (1 contoh terpendek yang emosinya cocok).
- Memori sesi kasur itu: fakta singkat pasien dan pembuka kalimat yang baru dipakai.

Aturan yang ditegakkan kode (`src/conversation/pasca_proses.py`), bukan hanya diminta ke LLM:
- **Alarm:** jika level lokal merah/oranye, kalimat "Perawat sedang menuju ke sini, {panggilan}." diucapkan Vine sendiri sebagai kalimat pertama, tanpa menunggu LLM. Kalimat LLM yang menyebut perawat lagi dibuang.
- **Level hijau:** kalimat yang mengklaim perawat sedang datang atau sudah dipanggil dibuang. Menawarkan ("Mau saya panggilkan perawat?") boleh.
- **Kenaikan level:** untuk maksud `pertanyaan_medis` dan `ngobrol`, LLM hanya boleh menaikkan level jika `alasan` berisi gejala (`kenaikan_level` di `thresholds.yaml`). Setiap kenaikan dan penolakan dicatat di log (hanya maksud dan level).
- **Sapaan:** lansia/dewasa tidak pernah "Anda" (diganti Bapak/Ibu atau nama panggilan); remaja "kamu".
- **Panjang (level hijau, per persona di `config/gaya_bicara.yaml`):** lansia 2–3 kalimat / 25–40 kata (≤ 15 kata per kalimat), dewasa 2–4 kalimat / 30–50 kata, remaja 2–4 kalimat / 25–45 kata. Susunan: tanggapi perasaan/isi ucapan → komentar, cerita kecil, atau hal menarik soal topiknya → tutup dengan 1 pertanyaan terbuka. Batas atas ditegakkan kode (kalimat yang membuat total kata lewat batas dibuang); batas bawah lewat prompt.
- **Merah/oranye:** tetap singkat, maksimal 2 kalimat termasuk kalimat alarm.
- **Anti-pengulangan:** 5 pembuka kalimat terakhir per kasur tidak boleh dipakai lagi (dibuang/dipotong di kode). Template cadangan punya minimal 4 variasi per situasi dan tidak mengulang yang terakhir. Kalimat alarm sengaja tetap satu.

**Ekspresi** (`senang`, `antusias`, `empati`, `tenang`, `bercanda`, `serius`, `netral`) dipilih LLM. Kode memaksa: kalimat alarm `serius`, sisanya `tenang` saat merah; pasien marah tidak pernah `bercanda`; nilai tidak dikenal menjadi `netral`. Ada di setiap event `kalimat`, di `selesai`, dan di jawaban `/process-*`.

**Memori (RAM saja):** per kasur maksimal 6 giliran terakhir (diringkas) dan 5 fakta singkat yang dipilih LLM lewat field `ingat` (misalnya "punya 3 cucu"). Tidak pernah ditulis ke file atau log. Dihapus total oleh `/reset-session`, `/greeting`, perintah suara "Vine off", atau sesi kedaluwarsa.

**Topik (RAM saja, `src/conversation/topik.py`):** tiap ucapan pasien diubah menjadi vektor (model kecil `models/topik-minilm`, sekitar 25 ms di CPU; cadangan: IndoBERT maksud). Per kasur disimpan topik aktif (vektor rata-rata, ringkasan ≤ 12 kata, giliran) dan maksimal 3 topik lama (ringkasan + vektor). Ucapan baru lanjut jika kosinus dengan topik aktif ≥ `topik.ambang`; ucapan pendek atau berisi rujukan ("iya", "terus?", "dia") selalu lanjut; mirip topik lama → topik itu aktif lagi; selain itu topik baru. System prompt berisi aturan saja (< 350 token); ringkasan + giliran topik aktif, 1 baris topik lama, dan fakta pasien dikirim di pesan pengguna. Ikut terhapus bersama sesi. Siapkan modelnya sekali: `python training/siapkan_model_topik.py`; ukur akurasinya: `python training/evaluate_topik.py`.

**Pemanasan koneksi:** saat startup, server membuka koneksi ke Groq dan Gemini (panggilan daftar model, tanpa kuota generasi) dan menahannya tetap hidup (`koneksi.keepalive_detik`). Hasil dan lamanya terlihat di `/health` (`pemanasan_koneksi`). Gagal tidak menghentikan server.

File `prompts/*.md` tidak dipakai server lagi sejak Tahap 3 dan hanya disimpan sebagai arsip.

## Pemeriksa konteks alarm

Alarm ditentukan 2 tahap. **Kandidat**: aturan `kata_darurat` + IndoBERT (+ `penurun_level`), seperti sebelumnya. **Pemeriksa konteks** (`src/intent/konteks_alarm.py`, pola di `thresholds.yaml` bagian `konteks_alarm`) berlaku untuk semua pemicu (sakit, mati, jatuh, napas, pusing, darah, tolong, takut, infus, ...):

- **Langsung alarm, tidak pernah diturunkan:** permintaan perawat eksplisit ("panggil suster", "tolong saya"), ide bunuh diri/menyakiti diri (juga "dulu saya pernah ingin bunuh diri"), gejala berat yang dialami sekarang (sesak, nyeri dada, pingsan, kejang, berdarah, jatuh). Orang di dekat pasien yang pingsan/kejang juga tetap alarm.
- **Turun ke hijau:** kiasan/perasaan ("mau mati bosan", "sakit hati", "pusing mikirin"), masa lalu ("dulu", "pernah", "tahun lalu"), orang lain ("anak saya ..."), cerita/film/berita/mimpi, penyangkalan ("sudah tidak sesak"). LLM tidak boleh menaikkan level ucapan seperti ini.
- **Ragu** ("dada saya sesak mikirin biaya", "kayaknya agak pusing"): level tetap hijau, Vine bertanya singkat tanpa LLM ("Sekarang Bapak merasa sesak?", `konfirmasi_alarm` di `gaya_bicara.yaml`). Statusnya disimpan di sesi (RAM, 2 giliran). "Iya" atau menyebut gejala → alarm naik ke level kandidat, dengan ringkasan "Pasien membenarkan ... saat ditanya Vine"; "tidak" → lanjut ngobrol.
- Emosi pasien dan topik aktif hanya **memperkuat** penurunan, tidak pernah jadi satu-satunya alasan turun. Ucapan putus asa ("rasanya semua percuma") tidak diturunkan.
- Log hanya `konteks_alarm {pemicu: [kategori], keputusan, alasan: [kategori]}`, tanpa teks dan tanpa id kasur.

Uji: `python training/evaluate_konteks_alarm.py --salah` (data `data/test_cases/uji_konteks_alarm.csv`, tabel sebelum/sesudah per kategori pemicu).

## Balasan streaming (`/converse-stream`)

Endpoint ini membalas dengan Server-Sent Events (`text/event-stream`), supaya alarm dan kalimat pertama Vine sampai secepat mungkin:

1. `analisis`: transkrip, maksud, **level alarm lokal**, emosi, warna Vine. Dikirim **sebelum** LLM dipanggil.
2. `kalimat`: satu event per kalimat balasan, segera setelah kalimat itu selesai ditulis LLM dan lolos guardrails.
3. `selesai`: balasan lengkap, sumber, level akhir (LLM hanya boleh menaikkan), dan waktu tiap tahap.
4. `galat`: jika terjadi galat tak terduga. Alarm yang sudah dikirim di `analisis` tetap berlaku.

Body sama dengan `/process-audio`, tapi isi `audio` **atau** `teks`. Detail format event dan contoh kode frontend ada di [`docs/integrasi.md`](docs/integrasi.md).

Cara kerjanya:
- LLM diminta menulis header `[[level=...;ekspresi=...;alasan=...;ingat=...]]` di baris pertama lalu teks biasa (lihat `src/conversation/prompt_builder.py`), bukan JSON, karena JSON tidak bisa diucapkan sebelum selesai. Jika header hilang atau terpotong, dipakai level lokal.
- Teks dipotong per kalimat (`. ! ?`). Kalimat di bawah `streaming.min_kata_kalimat` kata digabung dengan kalimat berikutnya.
- Setiap kalimat diperiksa guardrails. Jika ada saran medis, kalimat itu diganti kalimat aman dan sisa balasan dihentikan.
- Jika LLM gagal sebelum menulis apa pun, dipakai cadangan (groq → gemini → template). Perintah perangkat, tanya ulang, dan "tidak ada ucapan" dijawab tanpa LLM.
- Balasan streaming tidak berisi suara dari server (`balasan_audio`); tablet membacakan setiap kalimat dengan Web Speech API.

`/process-audio` dan `/process-text` tetap ada dengan kontrak JSON yang sama.

## Penyedia STT/LLM

Penyedia suara ke teks dan penyusun balasan bisa ditukar tanpa mengubah kode.

| Pengaturan `.env` | Pilihan | Default | Cadangan otomatis |
| --- | --- | --- | --- |
| `STT_PROVIDER` | `groq`, `lokal` | `groq` | Groq gagal, batas waktu (10 detik), atau kuota habis → Whisper lokal |
| `LLM_PROVIDER` | `groq`, `gemini`, `template` | `groq` | groq → gemini → template |
| `GROQ_MODEL` | daftar model dipisah koma | `openai/gpt-oss-20b,qwen/qwen3.8-27b` | kuota model pertama habis → model berikutnya |

- **Groq Whisper** (`whisper-large-v3-turbo`): audio dikirim sebagai WAV 16 kHz mono, `language=id`, kosakata rumah sakit dari `stt.prompt_awal`. Skor keyakinan dan filter halusinasi sama dengan Whisper lokal.
- **Whisper lokal** dimuat hanya saat dibutuhkan (`STT_PROVIDER=lokal` atau saat Groq gagal), jadi tidak memakan RAM selama Groq dipakai. Hening di awal/akhir rekaman dipotong dulu dengan Silero VAD.
- **Groq LLM** memakai format JSON yang sama dengan Gemini (lihat `src/conversation/prompt_builder.py`). Untuk model penalaran, penalaran dibuat seminimal mungkin dan teksnya disembunyikan.
- Penyedia yang benar-benar dipakai dan lama tiap tahap ada di field `penyedia` dan `waktu` setiap jawaban. Alarm dan guardrails tidak bergantung pada penyedia: LLM mana pun hanya boleh menaikkan level alarm.
- Untuk membandingkan penyedia, pilih dari dropdown **Penyedia** di halaman `/demo`. Pilihan ini dikirim sebagai `stt_provider`/`llm_provider` dan hanya dihormati selama `VINE_DEMO_PAGE=1`.

Batas kuota Groq dari sisi kita diatur di `config/thresholds.yaml` (`groq_stt`, `groq_llm`). Nilai awal: Whisper 20 per menit dan 2000 per hari, LLM 30 per menit dan 1000 per hari per model. Samakan dengan angka di console.groq.com/settings/limits. Sisa kuota terlihat di `/health` (`kuota`).

**Privasi Groq:** menurut dokumentasi Groq, data inferensi tidak disimpan secara default, kecuali untuk pemantauan keandalan dan penyalahgunaan (maksimal 30 hari). Aktifkan **Zero Data Retention** di console.groq.com/settings/data-controls supaya data itu pun tidak disimpan. Data diproses di Amerika Serikat.

## Kuota Gemini

Sejak Desember 2025 kuota tier gratis Gemini diturunkan, dan bisa serendah 20 permintaan per hari per model. Cek angka terbaru di Google AI Studio (menu rate limit), lalu:
- Isi `gemini.maks_per_menit` dan `maks_per_hari` sesuai kuota itu.
- Isi `GEMINI_MODEL` dengan beberapa model dipisah koma. Jika kuota model pertama habis, model berikutnya dipakai.
- Selama pengembangan, pakai `LLM_PROVIDER=template` supaya kuota disimpan untuk hari demo.
- Sisa kuota terlihat di `/health` (`gemini_kuota`).

Jika semua kuota habis, Vine memakai balasan template per persona. Alarm dan emosi tetap jalan karena tidak bergantung pada Gemini.

## Integrasi

Panduan untuk tim frontend dan backend ada di [`docs/integrasi.md`](docs/integrasi.md): cara merekam, mode Vine off, memakai setiap field jawaban, contoh Edge Function, dan kode status.

## Suara Vine (TTS)

Kokoro belum mendukung bahasa Indonesia, jadi pilihannya:

| `TTS_PROVIDER` | Kelebihan | Kekurangan | Persiapan |
| --- | --- | --- | --- |
| `browser` | Paling ringan, tanpa beban laptop | Suara beda-beda per perangkat | Tidak ada. Frontend memakai Web Speech API dengan `lang = "id-ID"` |
| `piper` | Cepat di CPU, suara sama di semua tablet | Hanya 1 suara Indonesia, terdengar seperti pembaca berita | `pip install piper-tts`, unduh `id_ID-news_tts-medium.onnx` dan `.onnx.json` dari repositori Piper voices (folder `id/id_ID/news_tts/medium`) ke `models/tts/` |
| `mms` | Tidak perlu unduh file manual | Lebih lambat, suara kaku, lisensi non-komersial | Otomatis mengunduh `facebook/mms-tts-ind` |

Jika TTS server gagal, sistem otomatis kembali ke `browser`, dan kegagalan suara tidak pernah menggagalkan alarm.

## Data

| Lokasi | Isi | Dipakai untuk |
| --- | --- | --- |
| `data/intent/raw/kalimat_pasien.csv` | 546 kalimat pasien berlabel maksud | Training model maksud |
| `data/emotion/raw/kalimat_emosi.csv` | 394 kalimat berlabel emosi | Training model emosi |
| `data/persona/*.jsonl` | 40 contoh percakapan per kelompok umur | Contoh gaya bicara untuk Gemini. Panduan di `data/persona/README.md` |
| `data/test_cases/skenario_darurat.csv` | Kalimat yang wajib menjadi merah | Tes otomatis |
| `data/test_cases/uji_realistis_*.csv` | Kalimat dengan gaya berbeda, tidak dipakai training | Perkiraan akurasi dunia nyata |
| `data/stt_test/` | Rekaman suara tim (diisi tim) | Mengukur Whisper dan menetapkan ambang keyakinan |
| `data/wakeword/` | Rekaman "Vine on/off" (diisi tim) | Menguji wake word |

## Training

Model pembanding bisa dilatih di laptop. IndoBERT butuh GPU, jadi pakai `notebooks/colab_training.ipynb` di Google Colab.

| Skrip | Fungsi |
| --- | --- |
| `training/prepare_data.py` | Membagi data 70/15/15, lalu augmentasi train saja |
| `training/train_baseline.py` | Melatih dan mengevaluasi model pembanding |
| `training/cross_validate.py` | Akurasi yang lebih stabil dengan cross-validation, termasuk pengaruh ambang darurat |
| `training/train_intent.py`, `train_emotion.py` | Fine-tune IndoBERT (Colab) |
| `training/evaluate_intent.py`, `evaluate_emotion.py` | Evaluasi IndoBERT atau pembanding (`--model pembanding`) |
| `training/convert_emot.py` | Mengambil dataset EmoT dan menyesuaikan label |
| `training/generate_persona.py` | Draf contoh persona dengan Gemini, untuk diperiksa tim |
| `training/validate_persona.py` | Memeriksa format dan aturan dataset persona |
| `training/evaluate_stt.py` | WER Whisper dan saran ambang keyakinan dari rekaman tim |
| `training/train_wakeword.py` | Panduan wake word dan cek kelengkapan rekaman |
| `training/benchmark.py` | Mengukur kecepatan jalur teks dan audio di laptop sebelum demo |

Notebook:
- `notebooks/01_eksplorasi_data.ipynb`: jumlah data, kata khas per label, tabrakan dengan aturan darurat.
- `notebooks/02_analisis_kesalahan.ipynb`: perbandingan pembanding vs IndoBERT, confusion matrix, kalimat salah tebak, pengaruh ambang darurat.
- `notebooks/colab_training.ipynb`: training lengkap di Colab.

## Pengaturan penting (`config/thresholds.yaml`)

| Kunci | Arti | Nilai awal |
| --- | --- | --- |
| `stt.min_keyakinan` | Di bawah ini Vine bertanya ulang | 0,55 (tetapkan dari `evaluate_stt.py`) |
| `intent.ambang_darurat` | Darurat menang jika peluangnya melewati ini | 0,30 |
| `emosi.ambang.<model>` | Ambang netral per jenis model | indobert 0,6, pembanding 0,45 |
| `emosi.jendela_perataan` | Jumlah kalimat yang dirata-rata | 3 |
| `tts.kecepatan` | Kecepatan bicara per persona | remaja 1,05, dewasa 1,0, lansia 0,85 |
| `gemini.maks_per_menit`, `maks_per_hari` | Batas panggilan per model dari sisi kita | 10 per menit, 20 per hari (samakan dengan kuota di AI Studio) |
| `gemini.jeda_setelah_kuota_habis_detik` | Gemini diistirahatkan setelah error 429 | 60 |
| `gemini.batas_waktu_token_pertama_detik`, `batas_waktu_total_detik` | Batas waktu token pertama dan seluruh jawaban per model Gemini | 15, 15 |
| `gemini.ulang_ke_model_cadangan` | Timeout/503/504: coba model Gemini berikutnya sekian kali, lalu template | 1 |
| `gemini.matikan_thinking`, `maks_token_jika_berpikir` | Thinking dimatikan (thinking_budget=0); batas token jika model menolak | true, 1024 |
| `groq_stt.maks_per_menit`, `maks_per_hari`, `batas_waktu_detik` | Batas Groq Whisper | 20, 2000, 10 detik |
| `groq_llm.maks_per_menit`, `maks_per_hari`, `batas_waktu_detik` | Batas Groq LLM per model | 30, 1000, 8 detik |
| `groq_llm.maks_token` | Batas token jawaban LLM (supaya JSON tidak terpotong) | 1024 |
| `llm.batas_waktu_total_detik` | Batas waktu seluruh rantai groq → gemini, lewat dari ini langsung template | 12 |
| `stt.sisa_hening_ms` | Hening yang disisakan saat rekaman dipotong VAD | 200 |
| `streaming.min_kata_kalimat` | Kalimat streaming yang lebih pendek digabung dengan kalimat berikutnya | 3 |
| `percakapan.sesi_kedaluwarsa_jam` | Sesi tidak aktif dihapus otomatis | 12 |
| `percakapan.riwayat_maksimal`, `riwayat_maks_kata`, `fakta_maksimal` | Memori per kasur (RAM) | 6 giliran, 20 kata, 5 fakta |
| `percakapan.jumlah_contoh` | Contoh gaya di prompt (0: contoh dataset terlalu pendek untuk panjang balasan baru) | 0 |
| `topik.ambang` | Kosinus minimal untuk lanjut topik, per jenis model (dari `training/evaluate_topik.py`) | minilm 0.27, indobert 0.33 |
| `topik.maks_topik_lama`, `maks_giliran`, `ringkasan_maks_kata` | Memori topik per kasur (RAM) | 3, 4 giliran, 12 kata |
| `topik.kata_pendek`, `maks_kata_rujukan`, `pola_rujukan` | Ucapan pendek/rujukan yang selalu lanjut topik | 3 kata, 8 kata |
| `kenaikan_level.maksud_terkunci`, `pola_gejala` | Kapan LLM boleh menaikkan level | pertanyaan_medis, ngobrol |
| `koneksi.pemanasan_saat_startup`, `keepalive_detik` | Pemanasan koneksi Groq/Gemini | aktif, 120 |
| `server.maks_proses_bersamaan` | Rekaman yang diproses Whisper bersamaan, sisanya antre | 2 |
| `audio.maks_detik` | Rekaman lebih panjang dipotong, bagian akhir yang dipakai | 30 |
| `stt.prompt_awal` | Kosakata rumah sakit untuk membantu Whisper | lihat file |
| `stt.halusinasi` | Kalimat karangan Whisper saat hening ("terima kasih telah menonton") yang dibuang | lihat file |
| `kata_darurat` | Pola aturan merah dan oranye, dengan pengecualian | lihat file |

## Menyambungkan ke backend (Cloudflare named tunnel)

```bash
cloudflared tunnel login
cloudflared tunnel create vine-ml
cloudflared tunnel route dns vine-ml ml.domain-kalian.com
cloudflared tunnel run --url http://localhost:8000 vine-ml
```

Berikan alamat `https://ml.domain-kalian.com` dan `ML_API_KEY` ke tim backend.

## Tes

```bash
pytest
```

Tes memastikan antara lain: audio WAV dan data URL terbaca, kuota Gemini habis tidak mengganggu alarm, sesi kedaluwarsa terhapus, semua skenario darurat menjadi merah, Gemini tidak bisa menurunkan level alarm, saran medis diblokir, nama panggilan terpasang, dan dataset persona lolos validasi. Jalankan setiap kali model, aturan, atau data diubah.

## Aturan privasi

- Teks obrolan hanya ada di memori selama sesi. Tidak ditulis ke file, database, atau log.
- `src/utils/logger.py` menolak mencatat field yang berisi teks obrolan.
- Hanya nama panggilan (misalnya "Pak Yusuf") yang dikirim ke Groq/Gemini, bukan nama lengkap.
- Demo memakai data uji, karena Gemini tier gratis tidak menjamin data tidak dipakai Google.
- Untuk Groq, aktifkan Zero Data Retention (lihat bagian Penyedia STT/LLM).
