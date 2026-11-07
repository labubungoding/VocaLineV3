"""Ringkasan alarm untuk kartu di dashboard perawat, dipakai jika Gemini tidak memberi ringkasan."""
from __future__ import annotations

import re

from src.intent.safety_rules import normalisasi

_POLA = [
    (r"\b(mati|bunuh diri|capek hidup|cape hidup|lelah hidup|mengakhiri hidup|mau hidup|ingin hidup|pengen hidup)\b|\bmending\b.*\b(ga|gak|nggak|tidak) ada\b", "Ungkapan putus asa, perlu didampingi"),
    (r"\bdada\b", "Pasien mengeluh sakit dada"),
    (r"\b(sesak|napas|nafas)\b", "Pasien sesak napas"),
    (r"\bjatuh\b", "Pasien jatuh"),
    (r"\b(berdarah|darah|pendarahan|perdarahan)\b", "Pasien mengalami perdarahan"),
    (r"\b(pingsan|kejang)\b", "Pasien pingsan atau kejang"),
    (r"\binfus\b", "Infus pasien perlu dicek"),
    (r"\b(toilet|kamar mandi|pipis|buang air)\b", "Pasien butuh bantuan ke toilet"),
    (r"\b(mual|muntah)\b", "Pasien mual atau muntah"),
    (r"\b(nyeri|sakit)\b", "Pasien mengeluh nyeri"),
    (r"\b(haus|minum)\b", "Pasien minta air minum"),
]


def ringkasan_lokal(teks: str, level: str) -> str:
    if level == "hijau":
        return ""
    t = normalisasi(teks)
    for pola, ringkasan in _POLA:
        if re.search(pola, t):
            return ringkasan
    return "Keadaan darurat, segera cek pasien" if level == "merah" else "Pasien butuh bantuan perawat"
