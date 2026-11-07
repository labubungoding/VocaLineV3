"""Perintah perangkat yang ditangani tanpa memanggil Gemini.

Hasilnya dikirim ke frontend lewat field `perintah`, misalnya untuk mengecilkan volume.
Catatan: "Vine off" dan "Vine on" utamanya dideteksi wake word di browser tablet.
Pola di sini hanya cadangan jika ucapan itu sampai ke server.
"""
from __future__ import annotations

import re

from src.intent.safety_rules import normalisasi

VINE = r"(?:[vfwbp]h?[ae]?[iy]e?nn?[eao]?|vai|fai|wai)"

_PERINTAH = [
    ("vine_off", rf"\b(?:turn ?off|matikan|matiin|nonaktifkan) {VINE}\b|\b{VINE} ?(?:off|of|op|mati)\b",
     "Baik, saya istirahat dulu. Bilang Vine on kalau mau ngobrol lagi."),
    ("vine_on", rf"\b(?:turn ?on|nyalakan|nyalain|hidupkan) {VINE}\b|\b{VINE} ?(?:on|nyala|hidup)\b", "Halo, saya di sini lagi."),
    ("volume_turun", r"\b(kecilkan|kecilin|pelankan|turunkan|turunin)\b.*\b(suara\w*|volume)\b|\b(suara\w*|volume)\b.*\b(kecilkan|kecilin|turunin|terlalu keras|kekencengan)\b|\bterlalu keras\b", "Baik, suaranya saya kecilkan."),
    ("volume_naik", r"\b(besarkan|gedein|keraskan|naikkan|naikin)\b.*\b(suara\w*|volume)\b|\b(suara\w*|volume)\b.*\b(besarkan|gedein|naikin|kurang keras)\b", "Baik, suaranya saya besarkan."),
    ("bicara_pelan", r"\b(ngomong|bicara)(nya)? (lebih )?pelan\b|\bpelan pelan\b", "Baik, saya bicara lebih pelan."),
    ("ulangi", r"\b(ulangi|ulangin|ulang lagi|coba ulang|apa tadi|sekali lagi)\b|\b(bilang|ngomong|omong)\s+apa\b|\b(nggak|gak|ga|tidak) (dengar|denger|nangkep|kedengeran)\b", ""),
    ("diam", r"\b(diam dulu|stop dulu|berhenti bicara)\b", "Baik."),
]


def cocokkan(teks: str) -> tuple[str, str] | None:
    """Mengembalikan (nama_perintah, balasan) atau None."""
    t = normalisasi(teks)
    for nama, pola, balasan in _PERINTAH:
        if re.search(pola, t):
            return nama, balasan
    return None
