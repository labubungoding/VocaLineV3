"""Sesi per kasur, hanya di memori.

Menyimpan riwayat obrolan singkat (maks 6 giliran, diringkas), fakta singkat tentang pasien (maks 5),
pembuka kalimat terakhir Vine (anti-pengulangan), jendela emosi untuk perataan, dan pelacak topik
(topik aktif + maks 3 topik lama, lihat src/conversation/topik.py).
Tidak pernah ditulis ke file atau log.
Hilang saat server dimatikan, dihapus lewat /reset-session saat pasien pulang,
dan dihapus otomatis jika tidak aktif lebih lama dari percakapan.sesi_kedaluwarsa_jam.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

from src.emotion.prosodi import PatokanSuara
from src.emotion.smoothing import EmotionSmoother
from src.utils.logger import log_event


@dataclass
class Sesi:
    smoother: EmotionSmoother
    riwayat: deque = field(default_factory=lambda: deque(maxlen=6))
    balasan_terakhir: str = ""
    terakhir_aktif: float = 0.0
    fakta: deque = field(default_factory=lambda: deque(maxlen=5))
    pembuka: deque = field(default_factory=lambda: deque(maxlen=5))
    template_terakhir: dict = field(default_factory=dict)
    topik: object | None = None
    menunggu_konfirmasi: dict | None = None
    nada: PatokanSuara = field(default_factory=PatokanSuara)

    def ingat(self, fakta: str) -> None:
        """Menyimpan fakta singkat (maks 8 kata). Fakta yang sama tidak disimpan dua kali."""
        fakta = " ".join(str(fakta or "").split()[:8]).strip(" .,-")
        if not fakta or fakta.lower() in ("-", "kosong", "tidak ada", "none", "null"):
            return
        if fakta.lower() not in (f.lower() for f in self.fakta):
            self.fakta.append(fakta)


class SessionStore:
    def __init__(self, ambang_emosi: float, jendela_emosi: int, riwayat_maksimal: int,
                 kedaluwarsa_detik: float = 12 * 3600, jam: Callable[[], float] = time.monotonic,
                 fakta_maksimal: int = 5, buat_topik: Callable[[], object] | None = None,
                 ambang_emosi_langsung: float | None = None):
        self._fakta_maks = fakta_maksimal
        self._ambang_langsung = ambang_emosi_langsung
        self._buat_topik = buat_topik
        self._ambang = ambang_emosi
        self._jendela = jendela_emosi
        self._riwayat_maks = riwayat_maksimal
        self._kedaluwarsa = kedaluwarsa_detik
        self._jam = jam
        self._data: dict[str, Sesi] = {}
        self._lock = threading.Lock()

    def _bersihkan_kedaluwarsa(self, sekarang: float) -> None:
        lama = [k for k, s in self._data.items() if sekarang - s.terakhir_aktif > self._kedaluwarsa]
        for k in lama:
            del self._data[k]
        if lama:
            log_event("sesi_kedaluwarsa_dihapus", jumlah=len(lama))

    def lihat(self, id_kasur: str) -> Sesi | None:
        """Sesi tanpa membuat baru dan tanpa memperbarui waktu aktif (untuk log)."""
        with self._lock:
            return self._data.get(id_kasur)

    def ambil(self, id_kasur: str) -> Sesi:
        with self._lock:
            sekarang = self._jam()
            self._bersihkan_kedaluwarsa(sekarang)
            if id_kasur not in self._data:
                self._data[id_kasur] = Sesi(
                    smoother=EmotionSmoother(self._ambang, self._jendela, self._ambang_langsung),
                    riwayat=deque(maxlen=self._riwayat_maks),
                    fakta=deque(maxlen=self._fakta_maks),
                    topik=self._buat_topik() if self._buat_topik else None,
                )
            sesi = self._data[id_kasur]
            sesi.terakhir_aktif = sekarang
            return sesi

    def reset(self, id_kasur: str) -> bool:
        with self._lock:
            return self._data.pop(id_kasur, None) is not None

    def jumlah(self) -> int:
        return len(self._data)
