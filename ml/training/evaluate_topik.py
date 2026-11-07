"""Akurasi deteksi topik pada data/test_cases/uji_topik.csv (pasangan ucapan berlabel sama/beda topik).

    python training/evaluate_topik.py            # model topik (models/topik-minilm)
    python training/evaluate_topik.py indobert   # pembanding: mean pooling IndoBERT maksud

Untuk tiap pasangan: ucapan_a dianggap topik aktif, ucapan_b ucapan baru.
- "embedding": sama topik jika kosinus >= ambang
- "+aturan": ucapan pendek/rujukan (topik.kata_pendek, topik.pola_rujukan) selalu dianggap lanjut
Mencetak akurasi pada ambang di thresholds.yaml, ambang terbaik, dan lama embedding per kalimat.
"""
import csv
import statistics
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from config.settings import get_settings, get_thresholds
from src.conversation.topik import PelacakTopik, PenyematTopik


def main(jenis: str = "minilm") -> None:
    cfg = get_thresholds()["topik"]
    if jenis == "indobert":
        from src.intent.indobert_classifier import IntentClassifier

        s = get_settings()
        penyemat = PenyematTopik(None, IntentClassifier(s.path(s.intent_model_dir))._impl)
    else:
        penyemat = PenyematTopik(ROOT / cfg["model_dir"])
    ambang = cfg["ambang"].get(penyemat.jenis, 0.5)
    aturan = PelacakTopik(ambang, kata_pendek=cfg["kata_pendek"], maks_kata_rujukan=cfg["maks_kata_rujukan"],
                          pola_rujukan=cfg["pola_rujukan"])

    baris = list(csv.DictReader(open(ROOT / "data" / "test_cases" / "uji_topik.csv", encoding="utf-8")))
    penyemat.vektor("halo selamat pagi")
    skor, label, rujukan, waktu = [], [], [], []
    for b in baris:
        mulai = time.perf_counter()
        va = penyemat.vektor(b["ucapan_a"])
        waktu.append((time.perf_counter() - mulai) * 1000)
        vb = penyemat.vektor(b["ucapan_b"])
        skor.append(float(va @ vb))
        label.append(b["label"] == "sama")
        rujukan.append(aturan._pendek_atau_rujukan(b["ucapan_b"]) is not None)
    skor, label, rujukan = np.array(skor), np.array(label), np.array(rujukan)

    def akurasi(a: float, pakai_aturan: bool) -> float:
        tebak = (skor >= a) | (rujukan if pakai_aturan else False)
        return float((tebak == label).mean())

    print(f"Model: {penyemat.jenis}, {len(baris)} pasangan ({label.sum()} sama, {(~label).sum()} beda)")
    print(f"Kosinus sama: {skor[label].mean():.2f} ± {skor[label].std():.2f}, "
          f"beda: {skor[~label].mean():.2f} ± {skor[~label].std():.2f}")
    for pakai in (False, True):
        nama = "embedding+aturan" if pakai else "embedding"
        terbaik = max((akurasi(a, pakai), round(a, 2)) for a in np.arange(0.0, 1.0, 0.01))
        rentang = [round(a, 2) for a in np.arange(0.0, 1.0, 0.01) if akurasi(a, pakai) >= terbaik[0] - 1e-9]
        print(f"{nama:17s} akurasi @ {ambang} (thresholds.yaml) = {akurasi(ambang, pakai):.3f}; "
              f"@ 0.55 = {akurasi(0.55, pakai):.3f}; terbaik {terbaik[0]:.3f} pada {rentang[0]}-{rentang[-1]}")
    print(f"Lama embedding: median {statistics.median(waktu):.0f} ms, maks {max(waktu):.0f} ms")
    salah = [(s, b) for s, b, l, r in zip(skor, baris, label, rujukan) if ((s >= ambang) | r) != l]
    print(f"Salah @ {ambang} (+aturan): {len(salah)}")
    for s, b in salah:
        print(f"  {s:.2f} {b['label']}: {b['ucapan_a']} | {b['ucapan_b']}")


if __name__ == "__main__":
    main(*(sys.argv[1:2] or ["minilm"]))
