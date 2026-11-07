"""Lapis 1: aturan kata darurat.

Jaring pengaman yang selalu jalan, cepat, dan tidak butuh model.
Pola diatur di config/thresholds.yaml bagian kata_darurat.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from config.settings import get_thresholds


@dataclass
class HasilAturan:
    level: str | None
    pola: str | None


def _kompilasi(daftar: list) -> list[tuple[re.Pattern, re.Pattern | None]]:
    """Setiap entri boleh berupa string pola, atau dict {pola, kecuali}. `kecuali` boleh string atau daftar pola."""
    hasil = []
    for item in daftar:
        if isinstance(item, dict):
            kecuali = item.get("kecuali")
            if isinstance(kecuali, list):
                kecuali = "|".join(f"(?:{k})" for k in kecuali)
            kecuali = re.compile(kecuali) if kecuali else None
            hasil.append((re.compile(item["pola"]), kecuali))
        else:
            hasil.append((re.compile(item), None))
    return hasil


class SafetyRules:
    def __init__(self, pola: dict[str, list] | None = None):
        pola = pola or get_thresholds()["kata_darurat"]
        self._merah = _kompilasi(pola.get("merah", []))
        self._oranye = _kompilasi(pola.get("oranye", []))

    def check(self, teks: str) -> HasilAturan:
        t = normalisasi(teks)
        for level, daftar in (("merah", self._merah), ("oranye", self._oranye)):
            for p, kecuali in daftar:
                if p.search(t) and not (kecuali and kecuali.search(t)):
                    return HasilAturan(level, p.pattern)
        return HasilAturan(None, None)


def normalisasi(teks: str) -> str:
    t = teks.lower()
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()
