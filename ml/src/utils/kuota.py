"""Pembatas kuota untuk layanan luar tier gratis (Gemini, Groq LLM, Groq Whisper).

Dipakai bersama oleh src/conversation/chat.py dan src/speech/stt.py.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable


class PembatasKuota:
    """Menjaga supaya layanan tier gratis tidak kehabisan kuota. Satu pembatas untuk satu model.

    - Paling banyak `maks_per_menit` panggilan dalam 60 detik terakhir.
    - Paling banyak `maks_per_hari` panggilan dalam 24 jam terakhir.
    - Setelah error kuota (429), model diistirahatkan selama `jeda_detik` (atau sesuai header retry-after).
    Selama dibatasi, Vine memakai penyedia cadangan, dan alarm tetap jalan seperti biasa.
    """

    def __init__(self, maks_per_menit: int = 10, jeda_detik: float = 60, jam: Callable[[], float] = time.monotonic,
                 maks_per_hari: int | None = None):
        self.maks = maks_per_menit
        self.maks_hari = maks_per_hari
        self.jeda = jeda_detik
        self._jam = jam
        self._menit: deque[float] = deque()
        self._hari: deque[float] = deque()
        self._istirahat_sampai = 0.0
        self._lock = threading.Lock()

    def _buang_kedaluwarsa(self, sekarang: float) -> None:
        while self._menit and sekarang - self._menit[0] >= 60:
            self._menit.popleft()
        while self._hari and sekarang - self._hari[0] >= 86400:
            self._hari.popleft()

    def ambil_izin(self) -> bool:
        with self._lock:
            sekarang = self._jam()
            if sekarang < self._istirahat_sampai:
                return False
            self._buang_kedaluwarsa(sekarang)
            if len(self._menit) >= self.maks:
                return False
            if self.maks_hari is not None and len(self._hari) >= self.maks_hari:
                return False
            self._menit.append(sekarang)
            self._hari.append(sekarang)
            return True

    def sisa_menit_ini(self) -> int:
        with self._lock:
            self._buang_kedaluwarsa(self._jam())
            return max(0, self.maks - len(self._menit))

    def sisa_hari_ini(self) -> int | None:
        if self.maks_hari is None:
            return None
        with self._lock:
            self._buang_kedaluwarsa(self._jam())
            return max(0, self.maks_hari - len(self._hari))

    def sedang_istirahat(self) -> bool:
        return self._jam() < self._istirahat_sampai

    def kuota_habis(self, jeda_detik: float | None = None) -> None:
        """Dipanggil setelah error 429. `jeda_detik` diisi dari header retry-after jika ada."""
        with self._lock:
            self._istirahat_sampai = self._jam() + max(self.jeda, jeda_detik or 0)

    def status(self) -> dict:
        return {"sisa_menit_ini": self.sisa_menit_ini(), "sisa_hari_ini": self.sisa_hari_ini(),
                "istirahat": self.sedang_istirahat()}


class GalatKuota(Exception):
    """Kuota layanan luar habis (HTTP 429) atau pembatas kita menolak panggilan."""

    def __init__(self, pesan: str = "kuota habis", jeda_detik: float | None = None):
        super().__init__(pesan)
        self.jeda_detik = jeda_detik


def error_kuota(e: Exception) -> bool:
    if isinstance(e, GalatKuota):
        return True
    teks = f"{type(e).__name__} {e}".upper()
    return "429" in teks or "RESOURCE_EXHAUSTED" in teks or "QUOTA" in teks


def baca_retry_after(nilai: str | None) -> float | None:
    """Header retry-after dari Groq berisi jumlah detik."""
    try:
        return float(nilai) if nilai else None
    except ValueError:
        return None
