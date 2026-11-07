"""Lapis 2: klasifikasi maksud dengan IndoBERT.

Memuat model hasil training dari models/indobert-intent.
Jika model belum ada, memakai pengklasifikasi kata kunci sementara supaya server tetap bisa jalan.
"""
from __future__ import annotations

from pathlib import Path

from src.intent.safety_rules import SafetyRules, normalisasi
from src.utils.logger import log_warning

LABEL_MAKSUD = ["darurat", "bantuan", "pertanyaan_medis", "perintah", "ngobrol"]


class HFTextClassifier:
    """Pembungkus umum model klasifikasi Hugging Face. Dipakai untuk maksud dan emosi."""

    def __init__(self, model_dir: Path):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self._torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_dir)
        self.model.eval()
        self.id2label = {int(k): v for k, v in self.model.config.id2label.items()}

    def predict_proba(self, teks: str) -> dict[str, float]:
        inputs = self.tokenizer(teks, return_tensors="pt", truncation=True, max_length=64)
        with self._torch.no_grad():
            logits = self.model(**inputs).logits[0]
        probs = self._torch.softmax(logits, dim=-1).tolist()
        return {self.id2label[i]: p for i, p in enumerate(probs)}


def potong_kalimat(teks: str, maks_kata: int = 20, langkah: int = 10) -> list[str]:
    """Ucapan panjang dibagi menjadi potongan yang saling tumpang tindih.

    IndoBERT hanya membaca 64 token pertama, jadi "...cerita panjang... tolong dada saya sakit" di akhir
    bisa terpotong. Dengan dibagi, setiap bagian ucapan tetap diperiksa.
    """
    kata = teks.split()
    if len(kata) <= maks_kata:
        return [teks]
    potongan = [" ".join(kata[i:i + maks_kata]) for i in range(0, len(kata) - maks_kata + langkah, langkah)]
    return [p for p in potongan if p]


def gabung_maks(daftar: list[dict[str, float]]) -> dict[str, float]:
    """Peluang tertinggi per label dari semua potongan, lalu dinormalkan. Darurat di potongan mana pun ikut terbawa."""
    label = daftar[0].keys()
    maks = {lb: max(p.get(lb, 0.0) for p in daftar) for lb in label}
    total = sum(maks.values()) or 1.0
    return {lb: v / total for lb, v in maks.items()}


def gabung_rata(daftar: list[dict[str, float]]) -> dict[str, float]:
    label = daftar[0].keys()
    return {lb: sum(p.get(lb, 0.0) for p in daftar) / len(daftar) for lb in label}


class KeywordIntentFallback:
    """Pengganti sementara sebelum IndoBERT dilatih. Jangan dipakai untuk demo."""

    _MEDIS = ("obat", "dosis", "boleh nggak", "boleh gak", "boleh tidak", "penyakit", "hasil lab", "efek samping", "diagnosis")
    _BANTUAN = ("sakit", "haus", "minta tolong", "tolong ambil", "pusing", "mau ke kamar mandi")
    _PERINTAH = ("kecilkan", "besarkan", "volume", "ulangi", "ulang", "vine off", "vine on", "diam dulu", "pelan-pelan", "pelan pelan", "stop dulu", "terlalu keras")

    def __init__(self):
        self.rules = SafetyRules()

    def predict_proba(self, teks: str) -> dict[str, float]:
        t = normalisasi(teks)
        level = self.rules.check(teks).level
        if level == "merah":
            label = "darurat"
        elif any(k in t for k in self._PERINTAH):
            label = "perintah"
        elif any(k in t for k in self._MEDIS):
            label = "pertanyaan_medis"
        elif level == "oranye" or any(k in t for k in self._BANTUAN):
            label = "bantuan"
        else:
            label = "ngobrol"
        return {lb: (0.9 if lb == label else 0.025) for lb in LABEL_MAKSUD}


_MODEL_TERMUAT: dict[str, HFTextClassifier] = {}


def muat_klasifikasi(model_dir: Path, baseline_path: Path | None, cadangan, nama: str):
    """Urutan: IndoBERT terlatih -> model pembanding -> daftar kata kunci.

    Mengembalikan (implementasi, jenis) dengan jenis "indobert", "pembanding", atau "kata_kunci".
    """
    if (model_dir / "config.json").exists():
        kunci = str(Path(model_dir).resolve())
        try:
            if kunci not in _MODEL_TERMUAT:
                _MODEL_TERMUAT[kunci] = HFTextClassifier(model_dir)
            return _MODEL_TERMUAT[kunci], "indobert"
        except Exception as e:
            log_warning(f"{nama}_indobert_gagal_dimuat", error=str(e)[:200])
    if baseline_path is not None and baseline_path.exists():
        try:
            from src.intent.baseline import BaselineClassifier

            return BaselineClassifier(baseline_path), "pembanding"
        except Exception as e:
            log_warning(f"{nama}_pembanding_gagal_dimuat", error=str(e)[:200],
                        saran="latih ulang dengan: python training/train_baseline.py")
    log_warning(f"{nama}_pakai_kata_kunci", alasan="belum ada model terlatih")
    return cadangan, "kata_kunci"


class IntentClassifier:
    def __init__(self, model_dir: Path, baseline_path: Path | None = None, ambang_darurat: float = 1.0):
        self._impl, self.jenis = muat_klasifikasi(model_dir, baseline_path, KeywordIntentFallback(), "intent")
        self.ambang_darurat = ambang_darurat

    @property
    def terlatih(self) -> bool:
        return self.jenis != "kata_kunci"

    def predict(self, teks: str) -> tuple[str, dict[str, float]]:
        from src.intent.decide_level import pilih_maksud

        potongan = potong_kalimat(teks)
        if len(potongan) == 1:
            probs = self._impl.predict_proba(teks)
        else:
            probs = gabung_maks([self._impl.predict_proba(p) for p in potongan])
        return pilih_maksud(probs, self.ambang_darurat), probs
