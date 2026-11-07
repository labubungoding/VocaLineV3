"""Lapis 3: membaca level cadangan dari jawaban Gemini.

Gemini membalas dalam satu panggilan: kalimat balasan + level + ringkasan (lihat prompts/classifier.md).
Satu panggilan untuk dua tugas menghemat kuota tier gratis.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass


@dataclass
class JawabanLLM:
    balasan: str
    level: str | None
    ringkasan: str
    model: str = ""
    ekspresi: str = ""
    alasan: str = ""
    ingat: str = ""


def _teks(nilai) -> str:
    teks = str(nilai or "").strip()
    return "" if teks.lower() in ("-", "kosong", "none", "null", "tidak ada") else teks


def parse_jawaban(raw: str) -> JawabanLLM | None:
    """Mengurai JSON dari Gemini. Mengembalikan None jika formatnya rusak."""
    if not raw:
        return None
    teks = raw.strip()
    cocok = re.search(r"\{.*\}", teks, re.S)
    if not cocok:
        return None
    try:
        data = json.loads(cocok.group(0))
    except json.JSONDecodeError:
        return None
    balasan = str(data.get("balasan", "")).strip()
    if not balasan:
        return None
    level = data.get("level")
    if level not in ("merah", "oranye", "hijau"):
        level = None
    return JawabanLLM(balasan=balasan, level=level, ringkasan=_teks(data.get("ringkasan")),
                      ekspresi=_teks(data.get("ekspresi")).lower(), alasan=_teks(data.get("alasan")),
                      ingat=_teks(data.get("ingat")))
