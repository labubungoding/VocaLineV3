# Integrasi ml-service untuk tim frontend dan backend

Dokumen ini menjelaskan cara tablet pasien dan Edge Function memakai ml-service. Detail field ada di README dan di `http://<alamat-ml>/docs`.

## Gambaran alur

```
Tablet pasien ──audio──> Edge Function ──X-API-Key──> ml-service (laptop, lewat Cloudflare Tunnel)
      ^                       │
      │                       ├─ level_alarm merah/oranye → simpan ke tabel alarm → Realtime → dashboard perawat
      └──balasan_teks/audio───┘
```

Tablet **tidak pernah** memanggil ml-service langsung. Semua lewat Edge Function, supaya `ML_API_KEY` tidak ada di tablet.

## Frontend (tablet pasien)

### 1. Merekam ucapan

- Pakai `MediaRecorder`. Format WebM/Opus bawaan browser boleh langsung dikirim, ml-service yang mengonversi.
- Kirim **satu ucapan per permintaan**, bukan rekaman terus-menerus. Untuk tahu kapan pasien selesai bicara, pakai VAD di browser, misalnya paket `@ricky0123/vad-web` (Silero VAD versi web). Rekam saat `onSpeechStart`, kirim saat `onSpeechEnd`.
- Rekaman lebih dari 30 detik akan dipotong server, dan yang dipakai bagian akhirnya.
- Minta izin mikrofon sekali di awal, dan tahan layar tetap menyala dengan `navigator.wakeLock.request("screen")`.

### 2. Mode Vine aktif dan Vine off

| Mode | Yang mendengar | Dikirim ke server |
| --- | --- | --- |
| Vine aktif | VAD browser + wake word | Setiap ucapan |
| Vine off | Wake word saja ("Vine on") | Tidak ada |

Wake word dipasang di browser (Porcupine Web atau openWakeWord ONNX, lihat `training/train_wakeword.py`). Jika jawaban server berisi `perintah: "vine_off"`, frontend juga pindah ke mode off. Tombol darurat selalu tampil di kedua mode dan **tidak lewat ml-service**: langsung tulis alarm merah ke Supabase.

### 3. Memakai jawaban

| Field | Yang dilakukan frontend |
| --- | --- |
| `balasan_teks` | Ucapkan. Jika `balasan_audio` tidak null, putar audio itu. Jika null, pakai Web Speech API |
| `kecepatan_bicara` | Isi ke `utterance.rate` |
| `visual_vine` | Ganti tampilan Vine: `kuning`, `biru`, `tenang`, `ramah` |
| `perlu_tanya_ulang` | Jika true, kirim `jumlah_tanya_ulang + 1` pada ucapan berikutnya. Jika false, kembalikan ke 0 |
| `perintah` | `volume_turun` / `volume_naik`: atur volume. `bicara_pelan`: kurangi `rate`. `vine_off`: masuk mode off. `diam`: hentikan suara yang sedang diputar |
| `maksud = "tidak_ada_ucapan"` | Abaikan, jangan ucapkan apa-apa |
| `ekspresi` | Ekspresi wajah Vine: `senang`, `antusias`, `empati`, `tenang`, `bercanda`, `serius`, `netral`. Merah selalu `tenang` (kalimat alarm di stream: `serius`) |
| `waktu` | Opsional, untuk pemantauan. `{"stt_ms", "nlu_ms", "llm_pertama_ms", "llm_ms", "total_ms"}` dalam milidetik. `stt_ms` = 0 untuk `/process-text`. Di jalur JSON, `llm_pertama_ms` sama dengan `llm_ms` |
| `penyedia` | Opsional, untuk pemantauan. `{"stt": "groq" \| "lokal" \| "-", "llm": "groq:<model>" \| "gemini:<model>" \| "template" \| "-"}`. `-` berarti tahap itu tidak dijalankan (misalnya perintah perangkat dijawab tanpa LLM) |

Field `waktu` dan `penyedia` adalah tambahan. Semua field lama tetap ada dan artinya tidak berubah, termasuk `waktu_proses_ms` (sama dengan `waktu.total_ms`).

Field permintaan `stt_provider` dan `llm_provider` hanya untuk halaman uji `/demo`. Edge Function **tidak perlu** mengirimnya; jika `VINE_DEMO_PAGE=0`, server mengabaikannya.

Contoh Web Speech API:

```js
function ucapkan(teks, kecepatan) {
  const u = new SpeechSynthesisUtterance(teks);
  u.lang = "id-ID";
  u.rate = kecepatan;
  const suaraIndonesia = speechSynthesis.getVoices().find(v => v.lang.startsWith("id"));
  if (suaraIndonesia) u.voice = suaraIndonesia;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
```

Jangan rekam saat Vine sedang bicara, supaya suara Vine tidak ikut terkirim sebagai ucapan pasien.

### 4. Mode streaming: `POST /converse-stream` (disarankan)

Alarm sampai lebih dulu, dan tablet bisa mulai bicara setelah kalimat pertama tanpa menunggu balasan lengkap.

Body sama dengan `/process-audio`, tetapi isi **salah satu**: `audio` (base64) atau `teks`. Jika keduanya kosong atau keduanya diisi, server membalas 422. Audio rusak tetap dibalas HTTP 422, dan STT mati tetap 503, sebelum stream dimulai.

Jawaban berupa Server-Sent Events (`Content-Type: text/event-stream`). Setiap event berbentuk:

```
event: <nama>
data: <JSON satu baris>

```

| Event | Kapan | Isi `data` | Yang dilakukan |
| --- | --- | --- | --- |
| `analisis` | Selalu pertama, **sebelum** LLM dipanggil | `teks_pasien`, `skor_keyakinan`, `maksud`, `level_alarm`, `ringkasan_alarm`, `emosi`, `visual_vine`, `perlu_tanya_ulang`, `perintah`, `waktu {stt_ms, nlu_ms}`, `penyedia {stt}` | Backend: jika `level_alarm` merah/oranye, **tulis alarm sekarang**. Tablet: tampilkan visual, jalankan `perintah`, atur `jumlah_tanya_ulang` |
| `kalimat` | 0 kali atau lebih, berurutan. Jika level lokal merah/oranye, kalimat 0 adalah kalimat alarm dan dikirim langsung setelah `analisis` | `teks`, `urutan` (0, 1, ...), `kecepatan_bicara`, `ekspresi` | Tablet: masukkan ke antrian ucapan, langsung diucapkan; ganti ekspresi Vine |
| `selesai` | Selalu terakhir (jika tidak ada galat) | `balasan_teks` (lengkap), `sumber_balasan`, `ekspresi`, `level_alarm` (akhir), `ringkasan_alarm`, `kecepatan_bicara`, `penyedia {stt, llm}`, `waktu {stt_ms, nlu_ms, llm_pertama_ms, llm_total_ms, total_ms}` | Backend: jika `level_alarm` **naik** dibanding `analisis` (LLM menemukan tanda bahaya), tulis alarm tambahan |
| `galat` | Jika terjadi galat tak terduga; stream lalu ditutup | `pesan`, `jenis` | Tablet: tampilkan Vine istirahat. Alarm dari `analisis` tetap berlaku |

Catatan:
- Level alarm di `selesai` tidak pernah lebih rendah dari `analisis`.
- `maksud = "tidak_ada_ucapan"` → `analisis` lalu `selesai` tanpa `kalimat`. Abaikan.
- Jangan simpan `teks_pasien`, `kalimat`, atau `balasan_teks` ke database.
- Suara di tablet: nada/kecepatan per `ekspresi`, penyesuaian persona, filler ("Hmm...", "Iya, Pak...") dan semua
  angka VAD ada di `config/suara.yaml`. Tablet **wajib memuatnya dari `GET /pengaturan-suara` saat start** (lewat
  Edge Function), tanpa angka tertulis di kode: `docs/API_KONTRAK.md`, `docs/PANDUAN_FRONTEND.md`.
  Contoh pemakaian lengkap di `src/api/demo.html` (`muatPengaturanSuara`, `buatUcapan`, `prosesStream`).
  Filler hanya untuk level hijau; tunggu event `analisis` dulu, dan batalkan filler yang belum terdengar
  saat kalimat pertama tiba.
- Mode ngobrol (mic terus mendengar) dan barge-in: contoh lengkap di `src/api/demo.html` (bagian MODE NGOBROL),
  pengaturan di `config/suara.yaml` bagian `vad` (lewat `GET /pengaturan-suara`). Aturan penting:
  - Ucapan yang dimulai saat Vine bicara diabaikan, kecuali pasien bicara terus >= `vad.barge_in_ms` (barge-in): hentikan
    suara, kosongkan antrian, batalkan stream (`AbortController`), lalu kirim ucapan baru.
  - Kalimat alarm merah (kalimat 0) tidak pernah dipotong. Ucapan pasien selama alarm diproses setelah alarm selesai.
  - Web Speech API bisa macet jika `speak()` dipanggil tepat setelah `cancel()`. Beri jeda `mesin_suara.jeda_setelah_batal_ms`.
  - Tombol darurat tetap menulis alarm langsung ke Supabase, tidak lewat ml-service.
- `stt_provider`/`llm_provider` hanya untuk halaman `/demo`, tidak perlu dikirim.

Contoh membaca stream di browser (`EventSource` tidak bisa POST dengan header, jadi pakai `fetch`). Di produksi, tablet memanggil Edge Function, dan Edge Function meneruskan `res.body` apa adanya (`return new Response(res.body, { headers: { "Content-Type": "text/event-stream" } })`):

```js
async function converseStream(url, body, padaEvent) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" /* + header otentikasi Edge Function */ },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ml-service ${res.status}`);
  const pembaca = res.body.getReader();
  const dekoder = new TextDecoder();
  let sisa = "";
  for (;;) {
    const { value, done } = await pembaca.read();
    if (done) break;
    sisa += dekoder.decode(value, { stream: true });
    let batas;
    while ((batas = sisa.indexOf("\n\n")) >= 0) {
      const blok = sisa.slice(0, batas);
      sisa = sisa.slice(batas + 2);
      let nama = "", data = "";
      for (const b of blok.split("\n")) {
        if (b.startsWith("event:")) nama = b.slice(6).trim();
        else if (b.startsWith("data:")) data += b.slice(5).trim();
      }
      if (nama) padaEvent(nama, JSON.parse(data || "{}"));
    }
  }
}

// Pemakaian di tablet
speechSynthesis.cancel();
await converseStream(ML_EDGE_URL, { id_kasur, audio, umur, nama_panggilan, persona, jumlah_tanya_ulang },
  (nama, d) => {
    if (nama === "analisis") { aturVisual(d.visual_vine); jalankanPerintah(d.perintah); }
    if (nama === "kalimat") {
      const u = new SpeechSynthesisUtterance(d.teks);
      u.lang = "id-ID"; u.rate = d.kecepatan_bicara;
      speechSynthesis.speak(u);       // antre otomatis, kalimat pertama langsung diucapkan
    }
    if (nama === "galat") tampilkanVineIstirahat();
  });
```

Di Edge Function, alarm bisa ditulis saat event `analisis` tiba sambil tetap meneruskan stream ke tablet.

### 5. Jika ml-service tidak bisa dihubungi

Tampilkan Vine dalam keadaan "istirahat", dan biarkan tombol darurat tetap berfungsi. Jangan blokir tampilan.

## Backend (Supabase Edge Function)

### Kapan memanggil endpoint mana

| Kejadian | Endpoint | Catatan |
| --- | --- | --- |
| Pasien bicara | `POST /converse-stream` (disarankan) atau `POST /process-audio` | Hitung `persona` dari umur dan tabel `pengaturan`, sertakan `nama_panggilan`. Untuk stream, tulis alarm saat event `analisis` |
| Perawat menekan Aktifkan tablet | `POST /greeting` | Kirim hasilnya ke tablet lewat Realtime |
| Jam pengingat tiba (pg_cron) | `POST /reminder` | `jenis`: `makan_pagi`, `makan_siang`, `makan_malam`, `kunjungan_dokter`, `lainnya` |
| Perawat menekan Pasien pulang | `POST /reset-session` | Setelah data pasien dihapus |

### Setelah `/process-audio`

- Jika `level_alarm` = `merah` atau `oranye`: tulis ke tabel `alarm` (waktu, kamar, level, `ringkasan_alarm`). Dashboard perawat menerima lewat Realtime.
- Jika ml-service ragu apakah keluhan dialami sekarang (mis. "dada saya sesak mikirin biaya"), `level_alarm` tetap `hijau` dan `balasan_teks` berisi pertanyaan konfirmasi ("Sekarang Bapak merasa sesak?"). Jika pasien menjawab "iya" di giliran berikutnya, jawaban itu yang membawa `level_alarm` merah/oranye dengan `ringkasan_alarm` "Pasien membenarkan ... saat ditanya Vine". Backend tidak perlu perubahan.
- **Jangan simpan** `teks_pasien` dan `balasan_teks` ke database. Cukup diteruskan ke tablet.

### Contoh Edge Function

```ts
const ML_URL = Deno.env.get("ML_URL")!;      // https://ml.domain-kalian.com
const ML_KEY = Deno.env.get("ML_API_KEY")!;

async function panggilML(path: string, body: unknown) {
  const res = await fetch(`${ML_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": ML_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ml-service ${res.status}: ${await res.text()}`);
  return res.json();
}

// pasien bicara
const hasil = await panggilML("/process-audio", {
  id_kasur, audio, umur, nama_panggilan, persona, jumlah_tanya_ulang,
});
if (hasil.level_alarm !== "hijau") {
  await supabase.from("alarm").insert({
    id_kasur, level: hasil.level_alarm, ringkasan: hasil.ringkasan_alarm,
  });
}
```

### Kode status dari ml-service

| Kode | Arti | Tindakan |
| --- | --- | --- |
| 200 | Berhasil | Pakai jawaban |
| 401 | `X-API-Key` salah | Cek kunci di Edge Function |
| 422 | Audio rusak atau data tidak lengkap | Minta tablet merekam ulang |
| 503 | Whisper tidak aktif, atau `ML_API_KEY` belum diisi di server | Hubungi tim ML |
| Timeout | Laptop mati atau tunnel putus | Tablet tampilkan Vine istirahat, tombol darurat tetap jalan |
