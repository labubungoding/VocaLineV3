"""Evaluasi model maksud (alarm) pada data test, set uji realistis, dan skenario darurat wajib.

    python training/evaluate_intent.py                    # IndoBERT
    python training/evaluate_intent.py --model pembanding # TF-IDF + Logistic Regression

Angka terpenting: recall alarm MERAH setelah digabung aturan kata darurat (target minimal 0.95).
"""
from __future__ import annotations

import argparse

from common import TUGAS, muat_model, simpan_laporan
from evaluasi import laporan, level_gabungan, salah_tebak, uji_skenario_darurat


def main() -> None:
    import pandas as pd

    from config.settings import get_thresholds
    from src.intent.decide_level import pilih_maksud

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["indobert", "pembanding"], default="indobert")
    ap.add_argument("--ambang-darurat", type=float, default=None,
                    help="default: nilai intent.ambang_darurat di thresholds.yaml")
    a = ap.parse_args()
    ambang = a.ambang_darurat if a.ambang_darurat is not None else get_thresholds()["intent"]["ambang_darurat"]

    cfg = TUGAS["intent"]
    labels = cfg["labels"]
    model = muat_model("intent", a.model)
    hasil = {"model": a.model, "ambang_darurat": ambang}

    for nama, path in (("test", cfg["processed"] / "test.csv"), ("uji_realistis", cfg["uji_realistis"])):
        df = pd.read_csv(path)
        pred = [pilih_maksud(model.predict_proba(t), ambang) for t in df["teks"]]
        hasil[nama] = laporan(df["label"].tolist(), pred, labels, f"maksud / {nama} / {a.model}")
        hasil[nama]["salah"] = salah_tebak(df["teks"].tolist(), df["label"].tolist(), pred)
        lv = laporan(level_gabungan(df["teks"], df["label"]), level_gabungan(df["teks"], pred),
                     ["merah", "oranye", "hijau"], f"level alarm akhir / {nama}")
        hasil[nama]["level_alarm"] = lv
        r = lv["per_label"]["merah"]["recall"]
        print(f"\nRecall alarm merah ({nama}): {r:.3f} (target >= 0.95) {'LULUS' if r >= 0.95 else 'BELUM'}")

    hasil["skenario_darurat_gagal"] = uji_skenario_darurat(model)
    print(f"\nLaporan: {simpan_laporan(f'evaluasi_intent_{a.model}', hasil)}")


if __name__ == "__main__":
    main()
