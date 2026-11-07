"""Memilih contoh percakapan dari data/persona/*.jsonl untuk diberikan ke Gemini.

Contoh yang emosinya sama dengan emosi pasien saat ini didahulukan.
Penanda {panggilan} di contoh diganti dengan nama panggilan pasien.
"""
from __future__ import annotations

import json
import random
from functools import lru_cache

from config.settings import ROOT
from src.conversation.persona import isi_panggilan


@lru_cache
def muat_contoh(persona: str) -> tuple[dict, ...]:
    path = ROOT / "data" / "persona" / f"{persona}.jsonl"
    if not path.exists():
        return ()
    with open(path, encoding="utf-8") as f:
        return tuple(json.loads(baris) for baris in f if baris.strip())


def pilih_contoh(persona: str, emosi: str, jumlah: int = 4, seed: int | None = None) -> list[dict]:
    """Mengambil contoh dengan emosi yang sama lebih dulu, diacak supaya gaya Vine tidak monoton."""
    rng = random.Random(seed)
    semua = list(muat_contoh(persona))
    cocok = [c for c in semua if c.get("emosi") == emosi]
    lain = [c for c in semua if c.get("emosi") != emosi]
    rng.shuffle(cocok)
    rng.shuffle(lain)
    jumlah_cocok = min(len(cocok), max(1, jumlah - 1))
    return cocok[:jumlah_cocok] + lain[: jumlah - jumlah_cocok]


def format_contoh(contoh: list[dict], nama_panggilan: str | None = None) -> str:
    if not contoh:
        return ""
    baris = ["Contoh gaya bicara yang diharapkan:"]
    for c in contoh:
        baris.append(f"Pasien: {c['pasien']}\nVine: {isi_panggilan(c['ai'], nama_panggilan)}")
    return "\n\n".join(baris)
