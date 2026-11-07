"""Klasifikasi emosi pasien dengan IndoBERT.

Menghasilkan nilai peluang untuk ceria, sedih, marah, netral.
Jika model belum dilatih, memakai daftar kata sementara.
"""
from __future__ import annotations

import re
from pathlib import Path

from src.intent.indobert_classifier import gabung_rata, muat_klasifikasi, potong_kalimat
from src.intent.safety_rules import normalisasi

LABEL_EMOSI = ["ceria", "sedih", "marah", "netral"]


class KeywordEmotionFallback:
    """Pengganti sementara sebelum IndoBERT emosi dilatih. Jangan dipakai untuk demo."""

    _KATA = {
        "ceria": ("senang", "seneng", "bahagia", "lucu", "haha", "wkwk", "membaik", "boleh pulang", "terima kasih", "makasih", "menang", "segar"),
        "sedih": ("sedih", "kangen", "rindu", "sepi", "sendirian", "takut", "nangis", "beban", "meninggal", "capek hidup", "nggak ada yang"),
        "marah": ("kesal", "kesel", "nyebelin", "marah", "muak", "lama banget", "berisik", "lambat", "nggak enak", "ganggu", "sebel"),
    }

    def predict_proba(self, teks: str) -> dict[str, float]:
        t = normalisasi(teks)
        skor = {lb: sum(1 for k in kata if k in t) for lb, kata in self._KATA.items()}
        terbaik = max(skor, key=skor.get)
        label = terbaik if skor[terbaik] > 0 else "netral"
        return {lb: (0.85 if lb == label else 0.05) for lb in LABEL_EMOSI}


_NEGASI = r"(?:tidak|nggak|ngga|enggak|engga|gak|ga|ndak|nda|bukan|tak|belum)"


class PenguatKataKunci:
    """Kata emosi yang jelas (thresholds.yaml emosi.kata_kunci) menguatkan hasil model.

    IndoBERT dilatih dengan data kecil, jadi kalimat seperti "saya kesal sekali sama suster" kadang dinilai netral.
    Jika ada kata emosi yang tidak didahului kata negasi ("nggak marah kok"), peluang emosi itu dicampur:
    p = (1 - bobot) * p_model + bobot. Jika kata emosi yang berbeda sama banyaknya, tidak ada penguatan.
    """

    def __init__(self, cfg: dict | None):
        cfg = cfg or {}
        self.bobot = float(cfg.get("bobot", 0.75))
        self.pola: dict[str, re.Pattern] = {}
        for label in ("ceria", "sedih", "marah"):
            daftar = cfg.get(label) or []
            if daftar:
                gabung = "|".join(f"(?:{p})" for p in daftar)
                self.pola[label] = re.compile(rf"(?:^|\s)(?:({_NEGASI})\s+)?(?:\w+\s+)?\b({gabung})\b")

    @property
    def aktif(self) -> bool:
        return bool(self.pola) and self.bobot > 0

    def label(self, teks: str) -> str | None:
        t = normalisasi(teks)
        hitung = {}
        for label, pola in self.pola.items():
            n = 0
            for m in pola.finditer(t):
                if not m.group(1):
                    n += 1
            if n:
                hitung[label] = n
        if not hitung:
            return None
        urut = sorted(hitung.items(), key=lambda x: -x[1])
        if len(urut) > 1 and urut[0][1] == urut[1][1]:
            return None
        return urut[0][0]

    def kuatkan(self, teks: str, probs: dict[str, float]) -> dict[str, float]:
        if not self.aktif:
            return probs
        label = self.label(teks)
        if label is None:
            return probs
        return {lb: (1 - self.bobot) * p + (self.bobot if lb == label else 0.0) for lb, p in probs.items()}


class EmotionClassifier:
    def __init__(self, model_dir: Path, baseline_path: Path | None = None, kata_kunci: dict | None = None):
        self._impl, self.jenis = muat_klasifikasi(model_dir, baseline_path, KeywordEmotionFallback(), "emosi")
        self.penguat = PenguatKataKunci(kata_kunci)

    @property
    def terlatih(self) -> bool:
        return self.jenis != "kata_kunci"

    def predict_proba(self, teks: str) -> dict[str, float]:
        potongan = potong_kalimat(teks)
        probs = gabung_rata([self._impl.predict_proba(p) for p in potongan])
        probs = {lb: float(probs.get(lb, 0.0)) for lb in LABEL_EMOSI}
        return self.penguat.kuatkan(teks, probs)
