"""Evaluasi model emosi dan mencari ambang netral terbaik.

    python training/evaluate_emotion.py                    # IndoBERT
    python training/evaluate_emotion.py --model pembanding

Ambang dengan F1 makro tertinggi di data val dicetak di akhir.
Salin ke config/thresholds.yaml bagian emosi.ambang.<jenis model>.
"""
from __future__ import annotations

import argparse

from common import TUGAS, muat_model, simpan_laporan
from evaluasi import cari_ambang, laporan, salah_tebak, terapkan_ambang


def main() -> None:
    import pandas as pd

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["indobert", "pembanding"], default="indobert")
    a = ap.parse_args()

    cfg = TUGAS["emotion"]
    labels = cfg["labels"]
    model = muat_model("emotion", a.model)

    val = pd.read_csv(cfg["processed"] / "val.csv")
    ambang, skor = cari_ambang(val["label"].tolist(), [model.predict_proba(t) for t in val["teks"]], labels)
    print("F1 makro per ambang (data val):")
    for am, s in skor.items():
        print(f"  {am:.2f}: {s:.3f}{'  <- terbaik' if am == ambang else ''}")

    hasil = {"model": a.model, "ambang_terbaik": ambang, "f1_per_ambang": skor}
    for nama, path in (("test", cfg["processed"] / "test.csv"), ("uji_realistis", cfg["uji_realistis"])):
        df = pd.read_csv(path)
        pred = terapkan_ambang([model.predict_proba(t) for t in df["teks"]], ambang)
        hasil[nama] = laporan(df["label"].tolist(), pred, labels, f"emosi / {nama} / ambang {ambang}")
        hasil[nama]["salah"] = salah_tebak(df["teks"].tolist(), df["label"].tolist(), pred)

    print(f"\nSalin ke config/thresholds.yaml -> emosi.ambang.{a.model}: {ambang}")
    print(f"Laporan: {simpan_laporan(f'evaluasi_emosi_{a.model}', hasil)}")


if __name__ == "__main__":
    main()
