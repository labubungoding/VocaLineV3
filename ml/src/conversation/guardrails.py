"""Memeriksa balasan Vine sebelum diucapkan.

Memblokir balasan yang terlihat seperti saran medis (dosis, diagnosis, izin minum obat).
"""
from __future__ import annotations

import re

_POLA_MEDIS = [
    r"\b\d+\s*(mg|ml|miligram|mililiter|tablet|kapsul|tetes|sendok)\b",
    r"\b(dosis|takaran)\b",
    r"\b(minum|konsumsi|makan)lah\b.*\bobat\b",
    r"\bboleh (minum|konsumsi)\b.*\bobat\b",
    r"\b(anda|bapak|ibu|kamu) (menderita|mengidap|terkena|kena)\b",
    r"\bdiagnosis(nya)? (adalah|anda)\b",
    r"\b(hentikan|berhenti minum) obat\b",
    r"\b(paracetamol|parasetamol|panadol|sanmol|bodrex|paramex|ibuprofen|proris|aspirin|asetosal|"
    r"asam mefenamat|mefenamat|ponstan|amoxicillin|amoksisilin|antibiotik|antasida|promag|mylanta|"
    r"omeprazol\w*|lansoprazol\w*|ranitidin\w*|cetirizin\w*|ctm|loratadin\w*|dexametason\w*|deksametason\w*|"
    r"diazepam|alprazolam|obat tidur|obat penenang|obat pereda nyeri|pereda nyeri|antinyeri|analgesik)\b",
    r"\b(coba|cobalah|pakai|gunakan|minum)\s+(\w+\s+){0,2}(obat|salep|suplemen|jamu)\b",
    r"\bobat\s+(\w+\s+){0,2}(yang\s+)?(bagus|ampuh|manjur|cocok|paling baik|terbaik)\b",
]

BALASAN_AMAN = "Untuk urusan obat dan kondisi kesehatan, sebaiknya ditanyakan langsung ke perawat. Mau saya panggilkan perawat?"


def aman(balasan: str) -> bool:
    t = balasan.lower()
    return not any(re.search(p, t) for p in _POLA_MEDIS)


def saring(balasan: str) -> tuple[str, bool]:
    """Mengembalikan (balasan, diblokir)."""
    if aman(balasan):
        return balasan, False
    return BALASAN_AMAN, True
