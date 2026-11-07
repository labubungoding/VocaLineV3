"""Perataan emosi dan ambang netral.

Nilai peluang dari beberapa kalimat terakhir dirata-rata, lalu emosi dipakai hanya jika rata-rata
tertinggi melewati ambang. Ini mencegah visual Vine berganti-ganti setiap kalimat.

Pengecualian: kalimat terakhir yang emosinya SANGAT jelas (peluang >= ambang_langsung, mis. "saya kesal
sekali!") langsung dipakai. Tanpa ini, pasien harus marah/sedih 3 kalimat berturut-turut dulu sebelum
Vine menanggapi emosinya, dan dalam percakapan nyata emosi itu hampir tidak pernah muncul.
"""
from __future__ import annotations

from collections import deque

from src.emotion.emotion_classifier import LABEL_EMOSI


class EmotionSmoother:
    def __init__(self, ambang: float = 0.6, jendela: int = 3, ambang_langsung: float | None = None):
        self.ambang = ambang
        self.ambang_langsung = ambang_langsung
        self.riwayat: deque[dict[str, float]] = deque(maxlen=jendela)

    def tambah(self, probs: dict[str, float]) -> str:
        self.riwayat.append(probs)
        return self.emosi_sekarang()

    def _emosi_kuat_terakhir(self) -> str | None:
        """Emosi (bukan netral) kalimat terakhir jika peluangnya >= ambang_langsung."""
        if self.ambang_langsung is None or not self.riwayat:
            return None
        akhir = self.riwayat[-1]
        kandidat = {lb: akhir.get(lb, 0.0) for lb in LABEL_EMOSI if lb != "netral"}
        terbaik = max(kandidat, key=kandidat.get)
        return terbaik if kandidat[terbaik] >= self.ambang_langsung else None

    def rata_rata(self) -> dict[str, float]:
        if not self.riwayat:
            return {lb: 0.0 for lb in LABEL_EMOSI}
        n = len(self.riwayat)
        return {lb: sum(p.get(lb, 0.0) for p in self.riwayat) / n for lb in LABEL_EMOSI}

    def emosi_sekarang(self) -> str:
        kuat = self._emosi_kuat_terakhir()
        if kuat:
            return kuat
        rata = self.rata_rata()
        terbaik = max(rata, key=rata.get)
        if rata[terbaik] < self.ambang:
            return "netral"
        return terbaik
