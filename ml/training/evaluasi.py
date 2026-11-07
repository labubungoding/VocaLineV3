"""Fungsi evaluasi bersama untuk IndoBERT dan model pembanding."""
from __future__ import annotations

from common import ROOT


def laporan(y_true, y_pred, labels, judul: str) -> dict:
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score

    print(f"\n=== {judul} ({len(y_true)} kalimat) ===")
    print(classification_report(y_true, y_pred, labels=labels, zero_division=0, digits=3))
    print("Confusion matrix (baris = label asli, kolom = prediksi):")
    print("       " + " ".join(f"{lb[:7]:>8}" for lb in labels))
    for lb, baris in zip(labels, confusion_matrix(y_true, y_pred, labels=labels)):
        print(f"{lb[:7]:>7}" + " ".join(f"{n:>8}" for n in baris))
    rep = classification_report(y_true, y_pred, labels=labels, zero_division=0, output_dict=True)
    return {
        "akurasi": accuracy_score(y_true, y_pred),
        "f1_makro": f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0),
        "per_label": {lb: rep[lb] for lb in labels},
    }


def salah_tebak(teks, y_true, y_pred, maks: int = 15) -> list[dict]:
    salah = [{"teks": t, "asli": a, "prediksi": p} for t, a, p in zip(teks, y_true, y_pred) if a != p]
    if salah:
        print(f"\nContoh salah tebak ({len(salah)} total):")
        for s in salah[:maks]:
            print(f"  [{s['asli']} -> {s['prediksi']}] {s['teks']}")
    return salah


def uji_skenario_darurat(model) -> list[dict]:
    """Setiap kalimat di skenario_darurat.csv wajib menjadi merah setelah digabung aturan kata darurat."""
    import pandas as pd

    from src.intent.decide_level import level_lokal
    from src.intent.safety_rules import SafetyRules

    rules = SafetyRules()
    skenario = pd.read_csv(ROOT / "data/test_cases/skenario_darurat.csv")
    gagal = []
    for teks in skenario["teks"]:
        p = model.predict_proba(teks)
        lv = level_lokal(rules.check(teks).level, max(p, key=p.get))
        if lv != "merah":
            gagal.append({"teks": teks, "level": lv})
    print(f"\nSkenario darurat wajib: {len(skenario) - len(gagal)}/{len(skenario)} menjadi merah")
    for g in gagal:
        print(f"  TERLEWAT: {g['teks']} -> {g['level']}")
    return gagal


def level_gabungan(teks_list, prediksi_maksud) -> list[str]:
    """Level alarm akhir lokal (aturan + model), seperti yang terjadi di pipeline."""
    from src.intent.decide_level import level_lokal
    from src.intent.safety_rules import SafetyRules

    rules = SafetyRules()
    return [level_lokal(rules.check(t).level, m) for t, m in zip(teks_list, prediksi_maksud)]


def terapkan_ambang(probs: list[dict[str, float]], ambang: float) -> list[str]:
    hasil = []
    for p in probs:
        terbaik = max(p, key=p.get)
        hasil.append(terbaik if p[terbaik] >= ambang else "netral")
    return hasil


def cari_ambang(y_true, probs, labels) -> tuple[float, dict[float, float]]:
    from sklearn.metrics import f1_score

    kandidat = [round(0.25 + 0.05 * i, 2) for i in range(14)]
    skor = {a: f1_score(y_true, terapkan_ambang(probs, a), average="macro", labels=labels, zero_division=0)
            for a in kandidat}
    terbaik = max(skor, key=lambda a: (round(skor[a], 3), a))
    return terbaik, skor
