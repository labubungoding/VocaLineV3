"""Deteksi topik obrolan per kasur, hanya di memori (RAM).

- PenyematTopik: vektor kalimat (mean pooling, dinormalkan). Utama: model sentence-embedding multilingual kecil
  (models/topik-minilm, paraphrase-multilingual-MiniLM-L12-v2). Cadangan jika folder itu tidak ada: IndoBERT
  maksud yang sudah dimuat (lebih lemah untuk topik, lihat training/evaluate_topik.py).
- PelacakTopik: topik aktif (vektor rata-rata, ringkasan <= 12 kata, giliran) dan maks 3 topik lama
  (ringkasan + vektor saja). Disimpan di Sesi, jadi ikut terhapus saat /reset-session dan "Vine off".

Isi topik (ringkasan, giliran) tidak pernah ditulis ke file atau log.
"""
from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from src.utils.logger import log_warning

_PENGISI = {"iya", "ya", "iyaa", "oh", "ohh", "hmm", "eh", "nah", "terus", "trus", "lalu", "jadi", "sih", "deh",
            "dong", "nih", "kok", "loh", "lho", "kan", "gitu", "begitu", "aja", "saja"}

_TERMUAT: dict[str, tuple] = {}


class PenyematTopik:
    """Mengubah kalimat menjadi vektor (dinormalkan). `jenis`: "minilm", "indobert", atau "tidak_aktif"."""

    def __init__(self, model_dir: Path | None = None, cadangan=None):
        self.jenis = "tidak_aktif"
        self._tok = self._model = None
        if model_dir is not None and (Path(model_dir) / "config.json").exists():
            try:
                kunci = str(Path(model_dir).resolve())
                if kunci not in _TERMUAT:
                    from transformers import AutoModel, AutoTokenizer

                    _TERMUAT[kunci] = (AutoTokenizer.from_pretrained(model_dir),
                                       AutoModel.from_pretrained(model_dir).eval())
                self._tok, self._model = _TERMUAT[kunci]
                self.jenis = "minilm"
                return
            except Exception as e:
                log_warning("topik_model_gagal_dimuat", error=str(e)[:200])
        if cadangan is not None and hasattr(cadangan, "model") and hasattr(cadangan, "tokenizer"):
            self._tok, self._model = cadangan.tokenizer, cadangan.model.base_model
            self.jenis = "indobert"
            log_warning("topik_pakai_indobert", saran="jalankan: python training/siapkan_model_topik.py")
        else:
            log_warning("topik_tidak_aktif", alasan="tidak ada model embedding")

    @property
    def aktif(self) -> bool:
        return self._model is not None

    def vektor(self, teks: str) -> np.ndarray | None:
        if not self.aktif or not teks.strip():
            return None
        import torch

        x = self._tok(teks, return_tensors="pt", truncation=True, max_length=64)
        with torch.no_grad():
            h = self._model(**x).last_hidden_state[0]
        m = x["attention_mask"][0].unsqueeze(-1).float()
        v = ((h * m).sum(0) / m.sum()).numpy()
        n = float(np.linalg.norm(v))
        return v / n if n else None


def kosinus(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    return float(a @ b / (na * nb)) if na and nb else 0.0


def ringkas(teks: str, maks_kata: int = 12) -> str:
    """Ringkasan pendek dari satu ucapan: tanda baca dan kata pengisi di awal/akhir dibuang, maks `maks_kata` kata."""
    kata = re.sub(r"[^\w\s-]", " ", teks.lower()).split()
    while kata and kata[0] in _PENGISI:
        kata.pop(0)
    while kata and kata[-1] in _PENGISI:
        kata.pop()
    return " ".join(kata[:maks_kata])


@dataclass
class Topik:
    ringkasan: str
    vektor: np.ndarray
    jumlah: int = 1
    giliran: deque = field(default_factory=lambda: deque(maxlen=4))
    calon: list = field(default_factory=list)

    def tambah_vektor(self, v: np.ndarray) -> None:
        self.vektor = (self.vektor * self.jumlah + v) / (self.jumlah + 1)
        self.jumlah += 1


@dataclass
class Keputusan:
    status: str
    alasan: str
    skor: float | None
    skor_lama: float | None = None


class PelacakTopik:
    """Topik aktif + topik lama untuk satu kasur. Dipanggil sekali per ucapan pasien yang dibalas LLM."""

    def __init__(self, ambang: float = 0.27, maks_lama: int = 3, maks_giliran: int = 4,
                 ringkasan_maks_kata: int = 12, kata_pendek: int = 3, maks_kata_rujukan: int = 8,
                 pola_rujukan: str = r"\b(iya|terus|dia|itu)\b", giliran_maks_kata: int = 20):
        self.ambang = ambang
        self.giliran_maks_kata = giliran_maks_kata
        self.maks_giliran = maks_giliran
        self.maks_kata = ringkasan_maks_kata
        self.kata_pendek = kata_pendek
        self.maks_kata_rujukan = maks_kata_rujukan
        self.pola_rujukan = re.compile(pola_rujukan, re.I)
        self.aktif: Topik | None = None
        self.lama: deque[Topik] = deque(maxlen=maks_lama)
        self.terakhir: Keputusan | None = None

    def _pendek_atau_rujukan(self, teks: str) -> str | None:
        kata = re.sub(r"[^\w\s]", " ", teks.lower()).split()
        if len(kata) <= self.kata_pendek:
            return "pendek"
        if len(kata) <= self.maks_kata_rujukan and self.pola_rujukan.search(" ".join(kata)):
            return "rujukan"
        return None

    def _topik_baru(self, teks: str, v: np.ndarray) -> Topik:
        t = Topik(ringkas(teks, self.maks_kata), v.copy(), giliran=deque(maxlen=self.maks_giliran))
        t.calon.append((t.ringkasan, v))
        return t

    def _simpan_lama(self) -> None:
        if self.aktif is not None:
            self.lama.appendleft(Topik(self.aktif.ringkasan, self.aktif.vektor, self.aktif.jumlah))

    def _perbarui_ringkasan(self) -> None:
        """Ringkasan = ucapan isi yang paling dekat dengan rata-rata topik (paling mewakili)."""
        t = self.aktif
        t.ringkasan = max(t.calon, key=lambda c: kosinus(c[1], t.vektor))[0]

    def proses(self, teks: str, v: np.ndarray | None) -> Keputusan:
        """Menentukan topik ucapan baru, lalu mencatatnya sebagai giliran topik aktif."""
        aturan = self._pendek_atau_rujukan(teks)
        if self.aktif is None:
            if v is None:
                v = np.zeros(1)
            k = Keputusan("baru", "pertama", None)
            self.aktif = self._topik_baru(teks, v)
        elif aturan or v is None:
            k = Keputusan("lanjut", aturan or "pendek", None)
        else:
            skor = kosinus(v, self.aktif.vektor)
            skor_lama = [kosinus(v, t.vektor) for t in self.lama]
            terbaik = int(np.argmax(skor_lama)) if skor_lama else -1
            lama_maks = skor_lama[terbaik] if skor_lama else None
            if skor >= self.ambang:
                k = Keputusan("lanjut", "mirip", skor, lama_maks)
                self.aktif.tambah_vektor(v)
                self.aktif.calon.append((ringkas(teks, self.maks_kata), v))
                self._perbarui_ringkasan()
            elif lama_maks is not None and lama_maks >= self.ambang:
                k = Keputusan("kembali", "mirip_lama", skor, lama_maks)
                lama = self.lama[terbaik]
                del self.lama[terbaik]
                self._simpan_lama()
                self.aktif = Topik(lama.ringkasan, lama.vektor, lama.jumlah,
                                   giliran=deque(maxlen=self.maks_giliran), calon=[(lama.ringkasan, lama.vektor)])
                self.aktif.tambah_vektor(v)
                self.aktif.calon.append((ringkas(teks, self.maks_kata), v))
            else:
                k = Keputusan("baru", "beda", skor, lama_maks)
                self._simpan_lama()
                self.aktif = self._topik_baru(teks, v)
        self.aktif.giliran.append([self._potong(teks), ""])
        self.terakhir = k
        return k

    def _potong(self, teks: str) -> str:
        kata = teks.split()
        return " ".join(kata[: self.giliran_maks_kata]) + (" ..." if len(kata) > self.giliran_maks_kata else "")

    def catat_balasan(self, balasan: str) -> None:
        """Balasan Vine untuk giliran terakhir topik aktif."""
        if self.aktif is not None and self.aktif.giliran:
            self.aktif.giliran[-1][1] = self._potong(balasan)

    def konteks(self, maks_kata_lama: int = 8) -> dict | None:
        """Untuk prompt: ringkasan topik aktif, giliran sebelumnya (tanpa ucapan terakhir), dan daftar topik lama."""
        if self.aktif is None:
            return None
        return {
            "aktif": self.aktif.ringkasan,
            "giliran": [tuple(g) for g in list(self.aktif.giliran)[:-1]],
            "lama": [" ".join(t.ringkasan.split()[:maks_kata_lama]) for t in self.lama],
            "status": self.terakhir.status if self.terakhir else "baru",
        }
