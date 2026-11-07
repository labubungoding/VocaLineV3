"""Membersihkan data mentah, membaginya menjadi train/val/test (70/15/15), lalu augmentasi data train.

Contoh:
    python training/prepare_data.py --task intent
    python training/prepare_data.py --task emotion
    python training/prepare_data.py --task emotion --pakai-emot     # tambah data EmoT ke train
    python training/prepare_data.py --task intent --tanpa-augmentasi

Pembagian dilakukan SEBELUM augmentasi, dan hanya train yang diaugmentasi.
Jadi tidak ada variasi kalimat yang sama muncul di train dan test (tidak ada kebocoran data).
"""
from __future__ import annotations

import argparse

from augment import augmentasi
from common import ROOT, TUGAS, bersihkan


def main() -> None:
    import pandas as pd
    from sklearn.model_selection import train_test_split

    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=list(TUGAS), required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--tanpa-augmentasi", action="store_true")
    ap.add_argument("--variasi", type=int, default=2, help="jumlah variasi per kalimat train")
    ap.add_argument("--pakai-emot", action="store_true", help="khusus emotion: tambahkan data EmoT ke train")
    args = ap.parse_args()
    cfg = TUGAS[args.task]

    df = pd.read_csv(cfg["raw"])
    df["teks"] = df["teks"].map(bersihkan)
    df["label"] = df["label"].str.strip().str.lower()
    df = df[df["teks"].str.len() > 0].drop_duplicates(subset=["teks"])

    salah = sorted(set(df["label"]) - set(cfg["labels"]))
    if salah:
        raise SystemExit(f"Label tidak dikenal: {salah}. Label yang benar: {cfg['labels']}")

    print("Jumlah kalimat asli per label:")
    print(df["label"].value_counts().to_string())
    kurang = df["label"].value_counts()
    kurang = kurang[kurang < 100]
    if len(kurang):
        print(f"Peringatan: kurang dari 100 contoh: {', '.join(kurang.index)}")

    train, sisa = train_test_split(df, test_size=0.3, stratify=df["label"], random_state=args.seed)
    val, test = train_test_split(sisa, test_size=0.5, stratify=sisa["label"], random_state=args.seed)

    if args.pakai_emot and args.task == "emotion":
        emot = ROOT / "data/emotion/raw/emot_converted.csv"
        if not emot.exists():
            raise SystemExit("Jalankan dulu: python training/convert_emot.py")
        tambahan = pd.read_csv(emot)[["teks", "label"]]
        print(f"Menambah {len(tambahan)} kalimat EmoT ke train")
        train = pd.concat([train, tambahan], ignore_index=True)

    if not args.tanpa_augmentasi:
        pasangan = augmentasi(list(zip(train["teks"], train["label"])), args.variasi, args.seed)
        train = pd.DataFrame(pasangan, columns=["teks", "label"])

    cfg["processed"].mkdir(parents=True, exist_ok=True)
    for nama, bagian in (("train", train), ("val", val), ("test", test)):
        bagian[["teks", "label"]].sample(frac=1, random_state=args.seed).to_csv(
            cfg["processed"] / f"{nama}.csv", index=False)
        print(f"{nama}: {len(bagian)} baris")


if __name__ == "__main__":
    main()
