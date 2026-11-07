# Rekaman uji Whisper

Dipakai `training/evaluate_stt.py` untuk mengukur akurasi Whisper dan menetapkan `stt.min_keyakinan`.

## Cara merekam

1. Rekam 5 sampai 10 orang berbeda, campur usia dan logat, termasuk orang tua.
2. Setiap orang membaca 10 kalimat dari `data/intent/raw/kalimat_pasien.csv` (campur semua label), lalu 5 kalimat bebas.
3. Rekam dengan tablet atau HP yang akan dipakai demo, dari jarak sekitar 50 cm, di ruangan yang agak ramai.
4. Tambahkan sekitar 10 rekaman "buruk" dengan sengaja: bergumam, terlalu pelan, atau tertutup suara TV.
   Rekaman buruk ini yang membuat ambang keyakinan bisa ditentukan.
5. Simpan sebagai WAV di folder ini, misalnya `orang01_kal03.wav`.

## transkrip.csv

```csv
file,teks,jenis
orang01_kal01.wav,dada saya sakit sekali
orang01_kal02.wav,infus saya habis
```

Kolom `teks` berisi kalimat yang benar-benar diucapkan. Rekaman tidak masuk GitHub.
