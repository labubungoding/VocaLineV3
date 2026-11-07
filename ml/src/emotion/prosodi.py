"""Petunjuk emosi dari NADA SUARA (prosodi), bukan dari kata-kata.

Emosi utama tetap dari teks (IndoBERT + kata kunci). Modul ini menambahkan petunjuk dari cara pasien bicara:
- marah: suara jauh lebih keras dan/atau lebih tinggi dari biasanya (membentak, berteriak)
- sedih: suara jauh lebih pelan dan lebih rendah dari biasanya (lirih, lesu)

"Biasanya" = rata-rata ucapan pasien ini sebelumnya di sesi yang sama (patokan per kasur, hanya di RAM).
Patokan dipakai karena setiap orang, mikrofon, dan jarak bicara berbeda. Sebelum ada cukup ucapan,
tidak ada petunjuk sama sekali (tidak menebak dari satu kalimat).

Catatan: tablet menyalakan autoGainControl browser, jadi selisih kekerasan suara teredam. Karena itu tinggi
nada (F0) ikut dihitung; nada tidak terpengaruh penguat otomatis. Tidak ada isi ucapan yang disimpan.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

SAMPLE_RATE = 16000
LABEL = ("ceria", "sedih", "marah", "netral")


@dataclass
class CiriSuara:
    """Ringkasan nada satu ucapan."""

    keras_db: float
    nada_hz: float | None
    detik_bersuara: float


@dataclass
class PatokanSuara:
    """Rata-rata bergerak ciri suara pasien di satu sesi."""

    keras_db: float | None = None
    nada_hz: float | None = None
    jumlah: int = 0
    terakhir: str | None = field(default=None)


def _frame(audio: np.ndarray, panjang: int, langkah: int) -> np.ndarray:
    if len(audio) < panjang:
        return np.empty((0, panjang), dtype=np.float32)
    n = 1 + (len(audio) - panjang) // langkah
    idx = np.arange(panjang)[None, :] + langkah * np.arange(n)[:, None]
    return audio[idx]


def _f0(frames: np.ndarray, sr: int, f_min: float, f_max: float, ambang: float) -> np.ndarray:
    """Tinggi nada tiap frame (autokorelasi ternormalisasi lewat FFT). NaN jika frame tidak cukup periodik."""
    x = frames - frames.mean(axis=1, keepdims=True)
    n = x.shape[1]
    spektrum = np.fft.rfft(x, 2 * n, axis=1)
    ac = np.fft.irfft(np.abs(spektrum) ** 2, axis=1)[:, :n]
    energi = ac[:, :1]
    ac = np.where(energi > 1e-9, ac / np.maximum(energi, 1e-9), 0.0)
    lag_min, lag_max = int(sr / f_max), min(int(sr / f_min), n - 1)
    jendela = ac[:, lag_min:lag_max]
    lag = lag_min + np.argmax(jendela, axis=1)
    puncak = ac[np.arange(len(ac)), lag]
    for bagi in (3, 2):
        kecil = np.round(lag / bagi).astype(int)
        boleh = kecil >= lag_min
        kuat = ac[np.arange(len(ac)), np.clip(kecil, 0, n - 1)] >= 0.9 * puncak
        ganti = boleh & kuat
        lag = np.where(ganti, kecil, lag)
    f0 = sr / lag.astype(np.float64)
    return np.where(puncak >= ambang, f0, np.nan)


def ciri_suara(audio: np.ndarray, sr: int = SAMPLE_RATE, f_min: float = 70.0, f_max: float = 400.0,
               ambang_periodik: float = 0.45, min_detik: float = 0.3) -> CiriSuara | None:
    """Kekerasan dan tinggi nada bagian bersuara. None jika ucapan terlalu pendek/sepi."""
    if audio is None or len(audio) < sr * min_detik:
        return None
    a = np.asarray(audio, dtype=np.float32)
    panjang, langkah = int(0.04 * sr), int(0.01 * sr)
    frames = _frame(a, panjang, langkah)
    if not len(frames):
        return None
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-12)
    batas = max(-50.0, float(np.percentile(db, 90)) - 15.0)
    bersuara = db >= batas
    if bersuara.sum() * langkah / sr < min_detik:
        return None
    nada = _f0(frames[bersuara][::2], sr, f_min, f_max, ambang_periodik)
    nada = nada[~np.isnan(nada)]
    return CiriSuara(
        keras_db=float(np.median(db[bersuara])),
        nada_hz=float(np.median(nada)) if len(nada) >= 5 else None,
        detik_bersuara=float(bersuara.sum() * langkah / sr),
    )


def _skala(nilai: float, mulai: float, penuh: float) -> float:
    """0 di `mulai`, 1 di `penuh` (linear, dibatasi 0..1)."""
    if penuh == mulai:
        return 0.0
    return max(0.0, min(1.0, (nilai - mulai) / (penuh - mulai)))


class PembacaNada:
    """Menggabungkan petunjuk nada ke peluang emosi dari teks (thresholds.yaml emosi.suara)."""

    def __init__(self, cfg: dict | None):
        cfg = cfg or {}
        self.aktif = bool(cfg.get("aktif", True))
        self.min_ucapan = int(cfg.get("min_ucapan_patokan", 2))
        self.alfa = float(cfg.get("alfa_patokan", 0.3))
        self.bobot = float(cfg.get("bobot", 0.85))
        self.min_kekuatan = float(cfg.get("min_kekuatan", 0.5))
        m = cfg.get("marah", {})
        self.marah_db = (float(m.get("keras_mulai_db", 4)), float(m.get("keras_penuh_db", 10)))
        self.marah_st = (float(m.get("nada_mulai_st", 2)), float(m.get("nada_penuh_st", 5)))
        s = cfg.get("sedih", {})
        self.sedih_db = (float(s.get("pelan_mulai_db", 4)), float(s.get("pelan_penuh_db", 10)))
        self.sedih_st = (float(s.get("rendah_mulai_st", 1.5)), float(s.get("rendah_penuh_st", 4)))
        self.batas_teks_lain = float(cfg.get("abaikan_jika_teks_lain", 0.75))

    def petunjuk(self, ciri: CiriSuara | None, patokan: PatokanSuara) -> tuple[str | None, float]:
        """(label, kekuatan 0..1) dibanding patokan pasien. (None, 0) jika belum ada patokan / biasa saja."""
        if not self.aktif or ciri is None or patokan.jumlah < self.min_ucapan or patokan.keras_db is None:
            return None, 0.0
        selisih_db = ciri.keras_db - patokan.keras_db
        selisih_st = 0.0
        if ciri.nada_hz and patokan.nada_hz:
            selisih_st = 12 * math.log2(ciri.nada_hz / patokan.nada_hz)
        keras, tinggi = _skala(selisih_db, *self.marah_db), _skala(selisih_st, *self.marah_st)
        marah = max(keras, 0.6 * tinggi + 0.4 * keras)
        sedih = min(_skala(-selisih_db, *self.sedih_db), _skala(-selisih_st, *self.sedih_st)) if ciri.nada_hz else 0.0
        label, kuat = ("marah", marah) if marah >= sedih else ("sedih", sedih)
        return (label, kuat) if kuat >= self.min_kekuatan else (None, 0.0)

    def perbarui(self, ciri: CiriSuara | None, patokan: PatokanSuara, ada_petunjuk: bool) -> None:
        """Rata-rata bergerak. Ucapan yang beremosi kuat hanya sedikit menggeser patokan."""
        if ciri is None:
            return
        alfa = self.alfa * (0.3 if ada_petunjuk else 1.0)
        if patokan.keras_db is None:
            patokan.keras_db, patokan.nada_hz = ciri.keras_db, ciri.nada_hz
        else:
            patokan.keras_db += alfa * (ciri.keras_db - patokan.keras_db)
            if ciri.nada_hz:
                patokan.nada_hz = ciri.nada_hz if patokan.nada_hz is None else \
                    patokan.nada_hz + alfa * (ciri.nada_hz - patokan.nada_hz)
        patokan.jumlah += 1

    def gabung(self, ciri: CiriSuara | None, patokan: PatokanSuara, probs: dict[str, float]) -> dict[str, float]:
        """Peluang emosi teks + petunjuk nada. Patokan sesi ikut diperbarui."""
        label, kuat = self.petunjuk(ciri, patokan)
        if label:
            lain = max((p for lb, p in probs.items() if lb not in (label, "netral")), default=0.0)
            if lain >= self.batas_teks_lain:
                label = None
        self.perbarui(ciri, patokan, bool(label))
        patokan.terakhir = label
        if not label:
            return probs
        w = self.bobot * kuat
        return {lb: (1 - w) * p + (w if lb == label else 0.0) for lb, p in probs.items()}
