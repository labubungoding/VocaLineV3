"""Mengunduh dataset EmoT (IndoNLU) lalu menyesuaikan labelnya ke 4 emosi Vine.

EmoT berisi tweet berbahasa Indonesia dengan 5 label. Konversinya:
    happy   -> ceria
    love    -> ceria
    sadness -> sedih
    fear    -> sedih   (cemas dan takut ditanggapi Vine dengan sikap yang sama: lembut, berempati)
    anger   -> marah
EmoT tidak punya label netral, jadi netral tetap dari data kita sendiri.

Jalankan di Colab atau laptop (butuh internet):
    python training/convert_emot.py
    python training/prepare_data.py --task emotion --pakai-emot

Hasil: data/emotion/raw/emot_converted.csv. PERIKSA hasilnya secara manual, karena tweet sering
berisi sarkasme dan bahasa kasar. Data EmoT hanya ditambahkan ke train, bukan ke val/test.

Sumber: IndoNLU (Wilie dkk., 2020), https://github.com/IndoNLP/indonlu
"""
from __future__ import annotations

import argparse
import re

from common import ROOT

URL = "https://raw.githubusercontent.com/IndoNLP/indonlu/master/dataset/emot_emotion-twitter/{bagian}_preprocess.csv"
PETA = {"happy": "ceria", "love": "ceria", "sadness": "sedih", "fear": "sedih", "anger": "marah"}


def bersihkan_tweet(t: str) -> str:
    t = re.sub(r"\[USERNAME\]|\[URL\]|\[SENSITIVE-NO\]|@\w+|http\S+", " ", str(t))
    t = re.sub(r"#(\w+)", r"\1", t)
    return " ".join(t.split()).strip()


def main() -> None:
    import pandas as pd

    ap = argparse.ArgumentParser()
    ap.add_argument("--maks-per-label", type=int, default=300, help="batasi supaya data kita tidak tenggelam")
    ap.add_argument("--maks-kata", type=int, default=25, help="buang tweet yang terlalu panjang")
    a = ap.parse_args()

    bagian = []
    for nama in ("train", "valid"):
        df = pd.read_csv(URL.format(bagian=nama))
        kolom_teks = "tweet" if "tweet" in df.columns else df.columns[-1]
        kolom_label = "label" if "label" in df.columns else df.columns[0]
        bagian.append(pd.DataFrame({"teks": df[kolom_teks], "label_asli": df[kolom_label]}))
    df = pd.concat(bagian, ignore_index=True)

    df["label"] = df["label_asli"].str.strip().str.lower().map(PETA)
    df["teks"] = df["teks"].map(bersihkan_tweet)
    df = df.dropna(subset=["label"])
    df = df[df["teks"].str.split().str.len().between(3, a.maks_kata)].drop_duplicates(subset=["teks"])
    df = df.groupby("label", group_keys=False).apply(lambda g: g.sample(min(len(g), a.maks_per_label), random_state=42))

    out = ROOT / "data/emotion/raw/emot_converted.csv"
    df[["teks", "label", "label_asli"]].to_csv(out, index=False)
    print(df["label"].value_counts().to_string())
    print(f"Tersimpan: {out}")


if __name__ == "__main__":
    main()
