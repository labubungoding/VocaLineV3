"""Menetapkan level alarm akhir.

Aturan utama:
- Level lokal = yang tertinggi dari aturan kata darurat dan IndoBERT alarm.
- Gemini hanya boleh MENAIKKAN level, tidak pernah menurunkan.
"""
from __future__ import annotations

import re

URUTAN = {"hijau": 0, "oranye": 1, "merah": 2}

MAKSUD_KE_LEVEL = {
    "darurat": "merah",
    "bantuan": "oranye",
    "pertanyaan_medis": "hijau",
    "perintah": "hijau",
    "ngobrol": "hijau",
}


def pilih_maksud(probs: dict[str, float], ambang_darurat: float = 1.0) -> str:
    """Maksud dengan peluang tertinggi, KECUALI peluang darurat melewati ambang_darurat.

    Lebih baik alarm palsu daripada darurat terlewat, jadi darurat boleh menang
    walaupun bukan tebakan teratas. Ambang diatur di thresholds.yaml (intent.ambang_darurat).
    """
    if probs.get("darurat", 0.0) >= ambang_darurat:
        return "darurat"
    return max(probs, key=probs.get)


def level_dari_maksud(maksud: str) -> str:
    return MAKSUD_KE_LEVEL.get(maksud, "hijau")


def tertinggi(*levels: str | None) -> str:
    valid = [lv for lv in levels if lv in URUTAN]
    if not valid:
        return "hijau"
    return max(valid, key=lambda lv: URUTAN[lv])


def level_lokal(level_aturan: str | None, maksud: str) -> str:
    return tertinggi(level_aturan, level_dari_maksud(maksud))


def level_akhir(lokal: str, dari_llm: str | None) -> str:
    """Gemini boleh menaikkan, tidak boleh menurunkan."""
    return tertinggi(lokal, dari_llm)


def level_dengan_alasan(lokal: str, maksud: str, dari_llm: str | None, alasan: str,
                        maksud_terkunci: tuple[str, ...] | list[str], pola_gejala: str,
                        teks_pasien: str | None = None) -> tuple[str, bool]:
    """Seperti level_akhir, dengan satu syarat tambahan.

    Untuk maksud lokal yang "terkunci" (pertanyaan_medis, ngobrol), LLM hanya boleh menaikkan level
    jika `alasan` dari LLM berisi gejala fisik atau tanda bahaya (pola di thresholds.yaml).
    Jika `teks_pasien` diberikan, gejala itu juga harus ada di ucapan terakhir pasien, supaya keluhan
    lama di riwayat (yang alarmnya sudah terkirim) tidak memicu alarm baru.
    Mengembalikan (level, kenaikan_ditolak).
    """
    usulan = level_akhir(lokal, dari_llm)
    if URUTAN[usulan] > URUTAN[lokal] and maksud in maksud_terkunci:
        ada_alasan = bool(alasan and re.search(pola_gejala, alasan.lower()))
        di_ucapan = teks_pasien is None or bool(re.search(pola_gejala, teks_pasien.lower()))
        if not (ada_alasan and di_ucapan):
            return lokal, True
    return usulan, False


class PenurunLevel:
    """Menurunkan level dari IndoBERT ke hijau untuk keluhan/emosi biasa tanpa gejala (thresholds.yaml penurun_level).

    Hanya berlaku jika aturan kata darurat tidak cocok, maksud IndoBERT darurat/bantuan, ada kata keluhan,
    dan tidak ada gejala fisik / anggota tubuh / tanda bahaya / permintaan bantuan.
    """

    MAKSUD = ("darurat", "bantuan")

    def __init__(self, cfg: dict | None):
        cfg = cfg or {}
        self.aktif = bool(cfg.get("aktif", False))
        self.keluhan = self._gabung(cfg.get("pola_keluhan"))
        self.bahaya = self._gabung(cfg.get("pola_bahaya"))
        self.abaikan = self._gabung(cfg.get("abaikan"))

    @staticmethod
    def _gabung(daftar) -> re.Pattern | None:
        if not daftar:
            return None
        daftar = [daftar] if isinstance(daftar, str) else daftar
        return re.compile("|".join(f"(?:{p})" for p in daftar))

    def berlaku(self, teks: str, level_aturan: str | None, maksud: str) -> bool:
        """`teks` sebaiknya sudah dinormalisasi (huruf kecil, tanda baca jadi spasi)."""
        if not self.aktif or level_aturan or maksud not in self.MAKSUD or self.keluhan is None:
            return False
        if not self.keluhan.search(teks):
            return False
        bersih = self.abaikan.sub(" ", teks) if self.abaikan else teks
        return not (self.bahaya and self.bahaya.search(bersih))
