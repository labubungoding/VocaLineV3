# Panduan frontend (tablet pasien)

Panduan singkat untuk tim frontend. Kontrak endpoint: `docs/API_KONTRAK.md`. Alur alarm, stream, dan Supabase:
`docs/integrasi.md`. Contoh lengkap yang berjalan: halaman uji `src/api/demo.html` (`/demo`).

## Pengaturan suara: muat dari `GET /pengaturan-suara` saat start

**Wajib:** saat aplikasi tablet dibuka dan setiap sesi pasien dimulai, muat semua angka suara dan VAD dari
`GET /pengaturan-suara`. Jangan menulis angka suara/VAD langsung di kode frontend (diam akhir bicara, barge-in,
filler, pitch/rate, dan seterusnya). Dengan begitu tim ML bisa menyetel `config/suara.yaml` tanpa rilis ulang tablet.

- Panggil lewat Edge Function yang menambahkan header `X-API-Key`. Kunci tidak pernah disimpan di tablet.
- Muat **sebelum** mic, Mode Ngobrol, atau suara Vine dinyalakan. Sebelum pengaturan termuat, mic jangan aktif.
- Jika gagal (jaringan, 500): pakai pengaturan terakhir yang berhasil dimuat (simpan salinannya di penyimpanan
  lokal tablet), lalu coba lagi. Jika belum pernah berhasil sama sekali, tampilkan galat dan jangan nyalakan mic.
- **Tombol darurat tidak boleh bergantung pada pengaturan ini.** Tombol darurat menulis alarm langsung ke Supabase
  dan tetap mengucapkan kalimat alarm dengan suara bawaan browser jika pengaturan belum ada.

```js
let SUARA = null;
async function muatPengaturanSuara() {
  // Edge Function meneruskan ke ml-service GET /pengaturan-suara dengan X-API-Key
  const r = await fetch(EDGE_URL + "/pengaturan-suara", { headers: { Authorization: "Bearer " + tokenTablet } });
  if (!r.ok) throw new Error("pengaturan suara gagal dimuat: HTTP " + r.status);
  SUARA = await r.json();
  localStorage.setItem("vine-pengaturan-suara", JSON.stringify(SUARA));  // cadangan jika nanti gagal
  return SUARA;
}
```

## Memakai pengaturan

Suara Vine (Web Speech API), untuk setiap kalimat dengan `ekspresi` dan `kecepatan_bicara` dari server:

```js
const e = SUARA.ekspresi[ekspresi] || SUARA.ekspresi.netral;
const p = SUARA.persona[persona];
u.rate  = clamp(kecepatan_bicara * e.rate * p.rate * kecepatanTambahan, SUARA.batas.rate.min, SUARA.batas.rate.maks);
u.pitch = clamp(e.pitch + p.pitch, SUARA.batas.pitch.min, SUARA.batas.pitch.maks);
```

VAD mode ngobrol (`@ricky0123/vad-web`, model Silero v5):

```js
const v = SUARA.vad;
vad.MicVAD.new({
  model: "v5",
  positiveSpeechThreshold: v.ambang_bicara,
  negativeSpeechThreshold: Math.max(v.ambang_diam_min, v.ambang_bicara - v.selisih_ambang_diam),
  redemptionMs: v.diam_selesai_ms[persona],   // remaja 1000, dewasa 1200, lansia 1600 (saat ditulis)
  minSpeechMs: v.min_bicara_ms,
  preSpeechPadMs: v.pad_awal_ms,
  // ...
});
// Lama audio: jumlahSampel * 1000 / v.laju_sampel_hz (ms). WAV ke server: mono, v.laju_sampel_hz.
```

Aturan lain yang memakai pengaturan ini (contoh lengkap di `demo.html`):

- **Barge-in:** ucapan yang dimulai saat Vine bicara diabaikan, kecuali pasien bicara terus-menerus selama
  `vad.barge_in_ms` dengan peluang >= `vad.ambang_barge_in`: hentikan suara, kosongkan antrian, batalkan stream.
  Kalimat alarm merah tidak pernah dipotong.
- **Filler:** jika kalimat pertama belum tiba `filler.filler_ms` setelah pasien selesai bicara dan level hijau,
  ucapkan salah satu `filler.kalimat[persona]` dengan `filler.ekspresi` dan `kecepatan_persona[persona]`.
- **Mesin suara:** tunda `speak()` selama `mesin_suara.jeda_setelah_batal_ms` setelah `cancel()`; jika ucapan
  terdepan belum berbunyi setelah `mesin_suara.batas_macet_ms`, ulangi antrian.
- **Perintah suara pasien** (`perintah` di jawaban): `volume_turun`/`volume_naik`/`bicara_pelan` memakai
  `perintah_suara`. Mulai sesi dengan `volume_awal` dan `kecepatan_awal`.
- Persona diambil dari jawaban server atau pilihan perawat; `diam_selesai_ms` ikut persona pasien saat itu.
