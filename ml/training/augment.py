"""Augmentasi teks untuk data latih.

Membuat variasi kalimat yang mirip ucapan pasien sungguhan dan hasil Whisper:
ganti kata ganti (saya/aku/gue), ganti bentuk negasi (nggak/gak/tidak), tambah partikel (ya/dong/nih),
tambah kata pembuka (eh/anu/sus), dan salah ketik ringan seperti hasil STT.

PENTING: augmentasi hanya untuk data TRAIN. Data val dan test harus tetap asli,
supaya angka akurasi mencerminkan kemampuan model pada kalimat yang belum pernah dilihat.
"""
from __future__ import annotations

import random
import re

GANTI_KATA = [
    (r"\bsaya\b", ["aku", "saya"]),
    (r"\baku\b", ["saya", "aku", "gue"]),
    (r"\bnggak\b", ["gak", "ga", "tidak", "enggak"]),
    (r"\btidak\b", ["nggak", "gak"]),
    (r"\bgak\b", ["nggak", "tidak"]),
    (r"\bbanget\b", ["sekali", "bgt", "banget"]),
    (r"\bsekali\b", ["banget"]),
    (r"\btolong\b", ["tolongin", "minta tolong", "tolong"]),
    (r"\bmau\b", ["pengen", "ingin", "mau"]),
    (r"\bpengen\b", ["mau", "ingin"]),
    (r"\bsudah\b", ["udah", "sudah"]),
    (r"\budah\b", ["sudah"]),
]
PARTIKEL = ["ya", "dong", "nih", "sih", "deh", "lho"]
PEMBUKA = ["eh", "anu", "sus", "mbak", "vine", "aduh", "hmm"]


def _hapus_tanda_baca(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t.lower())).strip()


def _salah_ketik(t: str, rng: random.Random) -> str:
    kata = t.split()
    calon = [i for i, k in enumerate(kata) if len(k) > 4]
    if not calon:
        return t
    i = rng.choice(calon)
    k = kata[i]
    j = rng.randrange(1, len(k) - 1)
    kata[i] = k[:j] + k[j + 1:]
    return " ".join(kata)


def variasi(teks: str, rng: random.Random) -> str:
    t = _hapus_tanda_baca(teks)
    for pola, ganti in GANTI_KATA:
        if re.search(pola, t) and rng.random() < 0.5:
            t = re.sub(pola, rng.choice(ganti), t, count=1)
    r = rng.random()
    if r < 0.25:
        t = f"{t} {rng.choice(PARTIKEL)}"
    elif r < 0.4:
        t = f"{rng.choice(PEMBUKA)} {t}"
    if rng.random() < 0.15:
        t = _salah_ketik(t, rng)
    return t


def augmentasi(teks_label: list[tuple[str, str]], per_kalimat: int = 2, seed: int = 42) -> list[tuple[str, str]]:
    """Mengembalikan data asli + variasinya, tanpa duplikat."""
    rng = random.Random(seed)
    hasil, sudah = [], set()
    for teks, label in teks_label:
        for t in [teks] + [variasi(teks, rng) for _ in range(per_kalimat)]:
            kunci = _hapus_tanda_baca(t)
            if kunci and kunci not in sudah:
                sudah.add(kunci)
                hasil.append((t, label))
    return hasil
