"""Cross-validation 5 lipatan untuk model pembanding.

Set test kita kecil (sekitar 15 kalimat per label), jadi satu salah tebak menggeser akurasi ~6%.
Cross-validation memakai seluruh data secara bergiliran sebagai test, sehingga angkanya lebih stabil.
Augmentasi hanya diterapkan ke bagian train di setiap lipatan.

    python training/cross_validate.py --task intent
    python training/cross_validate.py --task emotion
"""
from __future__ import annotations

import argparse
import statistics

from augment import augmentasi
from common import TUGAS, bersihkan, simpan_laporan


def main() -> None:
    import pandas as pd
    from sklearn.metrics import accuracy_score, f1_score, recall_score
    from sklearn.model_selection import StratifiedKFold

    from src.intent.baseline import buat_pipeline
    from src.intent.decide_level import level_lokal, pilih_maksud
    from src.intent.safety_rules import SafetyRules, normalisasi

    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=list(TUGAS), required=True)
    ap.add_argument("--lipatan", type=int, default=5)
    ap.add_argument("--ulang", type=int, default=3, help="diulang dengan seed berbeda")
    a = ap.parse_args()
    cfg = TUGAS[a.task]
    labels = cfg["labels"]

    df = pd.read_csv(cfg["raw"])
    df["teks"] = df["teks"].map(bersihkan)
    df = df.drop_duplicates(subset=["teks"]).reset_index(drop=True)
    rules = SafetyRules()

    ambang_list = [1.0, 0.5, 0.4, 0.3, 0.2]
    akurasi, f1, recall_utama, recall_merah = [], [], [], []
    per_ambang = {am: {"recall_merah": [], "presisi_merah": [], "akurasi": []} for am in ambang_list}
    for seed in range(a.ulang):
        skf = StratifiedKFold(n_splits=a.lipatan, shuffle=True, random_state=seed)
        for idx_train, idx_test in skf.split(df["teks"], df["label"]):
            tr, te = df.iloc[idx_train], df.iloc[idx_test]
            aug = augmentasi(list(zip(tr["teks"], tr["label"])), 2, seed)
            pipe = buat_pipeline()
            pipe.fit([normalisasi(t) for t, _ in aug], [lb for _, lb in aug])
            probas = pipe.predict_proba([normalisasi(t) for t in te["teks"]])
            probs = [dict(zip(pipe.classes_, p)) for p in probas]
            pred = [max(p, key=p.get) for p in probs]
            akurasi.append(accuracy_score(te["label"], pred))
            f1.append(f1_score(te["label"], pred, average="macro"))
            if a.task == "intent":
                recall_utama.append(recall_score(te["label"], pred, labels=["darurat"], average="macro"))
                lv_asli = [level_lokal(rules.check(t).level, lb) for t, lb in zip(te["teks"], te["label"])]
                lv_pred = [level_lokal(rules.check(t).level, p) for t, p in zip(te["teks"], pred)]
                recall_merah.append(recall_score(lv_asli, lv_pred, labels=["merah"], average="macro"))
                from sklearn.metrics import precision_score
                for am in ambang_list:
                    pr = [pilih_maksud(p, am) for p in probs]
                    lv = [level_lokal(rules.check(t).level, x) for t, x in zip(te["teks"], pr)]
                    per_ambang[am]["recall_merah"].append(recall_score(lv_asli, lv, labels=["merah"], average="macro"))
                    per_ambang[am]["presisi_merah"].append(precision_score(lv_asli, lv, labels=["merah"], average="macro", zero_division=0))
                    per_ambang[am]["akurasi"].append(accuracy_score(te["label"], pr))

    def ringkas(nama, xs):
        m, s = statistics.mean(xs), statistics.stdev(xs)
        print(f"{nama:<38} {m:.3f} ± {s:.3f}")
        return {"rata_rata": m, "simpangan": s}

    print(f"\nCross-validation {a.lipatan} lipatan × {a.ulang} ulangan, model pembanding, tugas {a.task}")
    hasil = {"akurasi": ringkas("Akurasi", akurasi), "f1_makro": ringkas("F1 makro", f1)}
    if a.task == "intent":
        hasil["recall_darurat_model"] = ringkas("Recall darurat (model saja)", recall_utama)
        hasil["recall_merah_gabungan"] = ringkas("Recall alarm merah (aturan + model)", recall_merah)
        print("\nPengaruh ambang_darurat (1.0 = tanpa ambang):")
        print(f"{'ambang':>8} {'recall merah':>14} {'presisi merah':>14} {'akurasi maksud':>15}")
        hasil["per_ambang_darurat"] = {}
        for am, d in per_ambang.items():
            r, p_, ak = (statistics.mean(d[k]) for k in ("recall_merah", "presisi_merah", "akurasi"))
            hasil["per_ambang_darurat"][str(am)] = {"recall_merah": r, "presisi_merah": p_, "akurasi": ak}
            print(f"{am:>8} {r:>14.3f} {p_:>14.3f} {ak:>15.3f}")
    print(f"Laporan: {simpan_laporan(f'cv_baseline_{a.task}', hasil)}")


if __name__ == "__main__":
    main()
