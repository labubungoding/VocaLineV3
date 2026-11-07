# Laporan akurasi model Vine

Per 29 Oktober 2026. Angka di bawah dihasilkan ulang dengan:

```bash
python training/prepare_data.py --task intent
python training/prepare_data.py --task emotion
python training/train_baseline.py
python training/cross_validate.py --task intent
python training/cross_validate.py --task emotion
```

## Ringkasan

| Model | Tugas | Akurasi | Catatan |
| --- | --- | --- | --- |
| Pembanding (TF-IDF + Logistic Regression), **terukur** | Maksud (5 label) | **86,7% ± 2,5** | Cross-validation 5 lipatan × 3 ulangan |
| Pembanding, **terukur** | Emosi (4 label) | **76,4% ± 4,3** | Cross-validation 5 lipatan × 3 ulangan |
| Pembanding, **terukur** | Recall alarm merah (aturan + model, ambang darurat 0,30) | **93,7%** | Presisi alarm merah 72% |
| IndoBERT, **terukur** (Colab) | Maksud | **91,5%** test, 88,9% uji realistis | Pembanding di set test yang sama: 82,9% |
| IndoBERT, **terukur** | Emosi (ambang 0,6) | **88,3%** test, 90,6% uji realistis | Pembanding di set test yang sama: 66,7% |
| IndoBERT + aturan darah, **terukur** | Recall alarm merah | **100%** test (presisi 90%), 100% uji realistis (presisi 85,7%) | Sama persis di ambang darurat 0,3, 0,4, dan 0,5 |

IndoBERT dilatih tim di Google Colab (31 Oktober 2026). Sebelum aturan "darah keluar" ditambahkan, recall alarm merah IndoBERT 94,4% (test) dan 91,7% (uji realistis); yang terlewat adalah "saya batuk darah" dan "bekas jahitan saya ngocor darahnya". Karena aturan itu dibuat setelah melihat kesalahan tersebut, recall 100% di set ini terlalu optimis; angka final perlu diukur dengan set uji buta.

Alarm palsu IndoBERT: "pengen cepat pulang rasanya", "diam sebentar saya mau tidur", "besok katanya mau ada yang jenguk saya". Hasil di ambang 0,3, 0,4, dan 0,5 sama persis, jadi penyebabnya bukan ambang; perbaikannya dengan menambah contoh serupa di label yang benar. Ambang darurat tetap 0,30.

## Dataset

| Dataset | Jumlah kalimat asli | Label | Setelah augmentasi (train) |
| --- | --- | --- | --- |
| Maksud (alarm) | 546 | darurat 122, bantuan 125, pertanyaan_medis 99, perintah 99, ngobrol 101 | 864 |
| Emosi | 394 | ceria 97, sedih 99, marah 99, netral 99 | 622 |
| Uji realistis maksud | 54 | terpisah, tidak dipakai training | tidak diaugmentasi |
| Uji realistis emosi | 32 | terpisah, tidak dipakai training | tidak diaugmentasi |
| Skenario darurat wajib | 14 | semua wajib menjadi merah | tidak diaugmentasi |

Augmentasi (variasi kata ganti, negasi, partikel, salah ketik ringan) hanya diterapkan ke data train setelah pembagian, jadi tidak ada kebocoran ke data test.

## Proses perbaikan

| Langkah | Akurasi maksud (CV) | Recall alarm merah (CV) |
| --- | --- | --- |
| Dataset awal (496 kalimat) | 84,5% | 86,8% |
| Tambah 25 kalimat darurat (tanda stroke, istilah pingsan sehari-hari) dan 25 keluhan ringan, tambah aturan stroke dan "semaput" | 86,7% | 92,1% |
| Ambang darurat 0,30 (darurat menang jika peluangnya ≥ 30%) | 85,2% | 93,7% |

## Pengaruh ambang darurat (model pembanding, CV)

| Ambang | Recall merah | Presisi merah | Akurasi maksud |
| --- | --- | --- | --- |
| 1,0 (tanpa ambang) | 92,1% | 78,5% | 86,7% |
| 0,4 | 92,1% | 77,6% | 86,6% |
| **0,3 (dipakai)** | **93,7%** | **72,4%** | **85,2%** |
| 0,2 | 95,4% | 62,9% | 82,3% |

Ambang 0,3 dipilih sebagai titik tengah untuk model pembanding. Setelah IndoBERT dilatih, ambang ditetapkan ulang dengan `evaluate_intent.py --ambang-darurat`.

## Kesalahan yang paling sering (model pembanding)

- **Keluhan ringan dianggap darurat**, misalnya "punggung saya sakit". Penyebabnya, kata "sakit" sangat sering muncul di kalimat darurat. Sudah dikurangi dengan menambah keluhan ringan di label bantuan.
- **Emosi netral tertukar dengan sedih atau ceria** pada kalimat yang menyebut keluarga, misalnya "anak saya datang nanti malam".
- **Marah yang halus tidak tertangkap**, misalnya "saya sudah bilang berkali kali". IndoBERT diperkirakan lebih baik di sini karena memahami konteks, bukan hanya kata.

## Batasan yang perlu diketahui tim

1. **Semua kalimat ditulis oleh satu penulis.** Gayanya cenderung seragam, jadi akurasi pada ucapan pasien sungguhan kemungkinan lebih rendah.
2. **Set uji realistis sudah "terlihat".** Aturan kata darurat diperbaiki setelah melihat kesalahan di set ini, sehingga recall 100% di set ini terlalu optimis. Untuk angka final di presentasi, minta 2 sampai 3 orang di luar tim ML menulis 50 kalimat baru yang belum pernah dilihat siapa pun, lalu uji dengan `evaluate_intent.py`.
3. **Belum termasuk kesalahan Whisper.** Angka di atas memakai teks yang sudah benar. Di sistem nyata, transkrip yang salah akan menurunkan akurasi. Ukur dengan `training/evaluate_stt.py` memakai rekaman tim.
4. **Set test kecil** (sekitar 15 kalimat per label), jadi satu salah tebak menggeser akurasi sekitar 6%. Karena itu angka utama memakai cross-validation.
