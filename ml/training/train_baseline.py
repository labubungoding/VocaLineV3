"""Melatih model pembanding (TF-IDF + Logistic Regression) untuk maksud dan emosi.

Cepat, bisa di CPU laptop (beberapa detik). Jalankan setelah prepare_data.py.
    python training/prepare_data.py --task intent
    python training/prepare_data.py --task emotion
    python training/train_baseline.py

Hasil:
- models/baseline-intent.joblib dan models/baseline-emotion.joblib (dipakai server jika IndoBERT belum ada)
- reports/baseline_intent.json dan reports/baseline_emotion.json
"""
from __future__ import annotations

import argparse

from common import TUGAS, simpan_laporan
from evaluasi import cari_ambang, laporan, level_gabungan, salah_tebak, terapkan_ambang, uji_skenario_darurat


def latih(tugas: str) -> dict:
    import joblib
    import pandas as pd

    from src.intent.baseline import BaselineClassifier, buat_pipeline
    from src.intent.safety_rules import normalisasi

    cfg = TUGAS[tugas]
    labels = cfg["labels"]
    train = pd.read_csv(cfg["processed"] / "train.csv")
    val = pd.read_csv(cfg["processed"] / "val.csv")
    test = pd.read_csv(cfg["processed"] / "test.csv")
    uji = pd.read_csv(cfg["uji_realistis"])

    pipe = buat_pipeline()
    pipe.fit(train["teks"].map(normalisasi), train["label"])
    cfg["baseline"].parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipe, cfg["baseline"])
    model = BaselineClassifier(cfg["baseline"])
    print(f"\n######## Model pembanding: {tugas} (train {len(train)} baris) ########")

    hasil = {"tugas": tugas, "jumlah_train": len(train)}
    for nama, df in (("test", test), ("uji_realistis", uji)):
        probs = [model.predict_proba(t) for t in df["teks"]]
        pred = [max(p, key=p.get) for p in probs]
        hasil[nama] = laporan(df["label"].tolist(), pred, labels, f"{tugas} / {nama}")
        salah_tebak(df["teks"].tolist(), df["label"].tolist(), pred)
        if tugas == "intent":
            lv_asli = level_gabungan(df["teks"], df["label"])
            lv_pred = level_gabungan(df["teks"], pred)
            hasil[nama]["level_alarm"] = laporan(lv_asli, lv_pred, ["merah", "oranye", "hijau"],
                                                 f"level alarm akhir (aturan + model) / {nama}")

    if tugas == "intent":
        hasil["skenario_darurat_gagal"] = uji_skenario_darurat(model)
    else:
        val_probs = [model.predict_proba(t) for t in val["teks"]]
        ambang, skor = cari_ambang(val["label"].tolist(), val_probs, labels)
        hasil["ambang_terbaik"] = ambang
        print(f"\nAmbang netral terbaik (data val): {ambang}  -> salin ke thresholds.yaml emosi.ambang.pembanding")
        for nama, df in (("test", test), ("uji_realistis", uji)):
            pred = terapkan_ambang([model.predict_proba(t) for t in df["teks"]], ambang)
            hasil[f"{nama}_dengan_ambang"] = laporan(df["label"].tolist(), pred, labels,
                                                     f"emosi / {nama} dengan ambang {ambang}")

    print(f"\nModel tersimpan: {cfg['baseline']}")
    print(f"Laporan: {simpan_laporan(f'baseline_{tugas}', hasil)}")
    return hasil


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=["intent", "emotion", "semua"], default="semua")
    a = ap.parse_args()
    for t in (["intent", "emotion"] if a.task == "semua" else [a.task]):
        latih(t)
