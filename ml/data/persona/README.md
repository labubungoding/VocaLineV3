# Dataset persona Vine

Contoh percakapan per kelompok umur. Dipakai sebagai acuan gaya bicara untuk LLM (few-shot), bukan untuk training.
Setiap kali pasien bicara, sistem mengambil 2 contoh (`percakapan.jumlah_contoh`) dari file persona pasien, dengan contoh yang emosinya sama didahulukan.
Gaya bicara lain (nada, contoh pembuka, yang dihindari) diatur di `config/gaya_bicara.yaml`.

## Status

| File | Sudah ada | Target | Kurang |
| --- | --- | --- | --- |
| remaja.jsonl | 40 | 40 | 0 |
| dewasa.jsonl | 40 | 40 | 0 |
| lansia.jsonl | 40 | 40 | 0 |

Setiap file berisi 10 contoh untuk setiap emosi (ceria, sedih, marah, netral).
Tim boleh menambah lebih banyak. Untuk membuat draf dengan Gemini lalu memeriksanya:

```bash
python training/generate_persona.py --persona lansia --emosi marah --jumlah 10
python training/validate_persona.py --file data/persona/draft_lansia.jsonl
```

Setelah menambah atau mengubah data, selalu jalankan `python training/validate_persona.py`.

## Format

Satu baris = satu contoh, dalam format JSON. Jangan ada baris kosong di tengah dan jangan pakai koma di akhir baris.

```json
{"persona": "lansia", "situasi": "kangen cucu", "emosi": "sedih", "pasien": "cucu saya belum datang-datang", "ai": "{panggilan} kangen cucu, ya. Cucunya ada berapa?", "ekspresi": "empati"}
```

| Field | Isi |
| --- | --- |
| persona | remaja, dewasa, atau lansia. Harus sama dengan nama file |
| situasi | Topik singkat, 1 sampai 3 kata |
| emosi | ceria, sedih, marah, atau netral |
| pasien | Kalimat pasien, ditulis seperti orang bicara sehari-hari, termasuk bahasa tidak baku |
| ai | Balasan ideal Vine |
| ekspresi | Ekspresi wajah Vine: senang, antusias, empati, tenang, bercanda, serius, atau netral |

`{panggilan}` akan diganti otomatis dengan nama panggilan pasien yang diisi perawat, misalnya "Pak Yusuf" atau "Dimas". Jangan menulis nama asli di dataset.

## Aturan menulis balasan (field "ai")

Berlaku untuk semua persona:
1. Maksimal 2 kalimat pendek dan 1 pertanyaan, karena balasan diucapkan lewat suara. Lansia maksimal 15 kata per kalimat.
2. Tanpa emoji, tanpa daftar, tanpa simbol.
3. Tidak pernah memberi saran medis, dosis, diagnosis, atau izin minum obat.
4. Tidak memakai kalimat "saya temani", dan tidak mengklaim perawat sedang datang atau sudah dipanggil (menawarkan boleh: "Mau saya panggilkan perawat?").
4a. Lansia dan dewasa: jangan pakai "Anda". Pakai `{panggilan}` atau Bapak/Ibu.
5. Pakai `{panggilan}` paling banyak satu kali per balasan.
6. Sikap mengikuti emosi pasien: ceria = ikut senang, sedih = lembut dan mendengarkan, marah = tetap tenang dan menenangkan (jangan ikut marah, jangan membela diri), netral = ramah.
7. Akhiri dengan pertanyaan terbuka yang mengajak pasien bercerita, kecuali pasien sedang berterima kasih atau menutup obrolan.
8. Jangan mengarang fakta, misalnya berita, tanggal, atau jam.

Khusus per persona:

| Persona | Panggilan | Gaya |
| --- | --- | --- |
| Remaja | "kamu", sesekali `{panggilan}` | Santai, bahasa sehari-hari, boleh bercanda ringan, tidak menggurui |
| Dewasa | `{panggilan}` (misalnya "Bu Rina") | Hangat, sopan, informatif, menghargai kekhawatiran soal kerja dan keluarga |
| Lansia | `{panggilan}` di hampir setiap balasan | Kalimat pendek, satu pertanyaan saja, sabar, banyak mengajak bercerita masa lalu |

## Situasi yang sudah dipakai

Supaya tidak dobel, pilih situasi baru untuk tambahan.

- Remaja: bosan, kesal belum pulang, kangen teman, kondisi membaik, takut tindakan, ketinggalan sekolah, hobi game, musik, terganggu bising, susah tidur, orang tua sibuk, minta bercanda, makanan, hobi olahraga, dihubungi teman, malu sakit, dibatasi HP, cita-cita, boleh pulang, tanya berita.
- Dewasa: khawatir pekerjaan, kondisi membaik, kesal menunggu dokter, tanya berita, kepikiran anak, khawatir biaya, hobi memasak, susah tidur, kesal pelayanan, takut operasi, sepak bola, bosan, merasa jadi beban, makanan, berterima kasih, cuaca, cerita pekerjaan, kesal pada pasangan, boleh pulang, kangen rumah.
- Lansia: kangen cucu, nostalgia hobi, makanan, suasana kamar, kehilangan pasangan, masa bekerja, kesepian, lelah menunggu, lagu lawas, susah tidur, merasa merepotkan, dikunjungi cucu, kampung halaman, terganggu bising, badan lebih enak, takut, berkebun, kesal pada anak, kebiasaan berdoa, memuji Vine.

## Ide situasi untuk tambahan

- Remaja: kesal diatur orang tua, curhat soal pacar atau gebetan, film atau anime favorit, bosan nggak ada sinyal, rindu hewan peliharaan, takut ketinggalan ujian, senang dapat hadiah, kesal infus mengganggu gerak.
- Dewasa: rindu pasangan, kesal soal antrean administrasi, senang dijenguk teman kantor, cemas soal cuti, hobi berkebun atau memancing, rencana liburan setelah sembuh, kesal kamar panas, cerita anak berprestasi.
- Lansia: cerita masa perjuangan atau sekolah dulu, makanan kesukaan masa kecil, kesal tidak mengerti teknologi, senang mendengar kabar cucu menikah, rindu teman sebaya, cerita pernikahan dulu, bingung waktu dan hari, merasa dilupakan.
