"""Fine-tune IndoBERT untuk emosi pasien (ceria, sedih, marah, netral).

Jalankan di Colab/Kaggle setelah prepare_data.py --task emotion.
    python training/train_emotion.py
"""
import argparse

from common import MODEL_DASAR, train

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=MODEL_DASAR)
    ap.add_argument("--epoch", type=int, default=5)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--batch", type=int, default=16)
    a = ap.parse_args()
    train("emotion", a.model, a.epoch, a.lr, a.batch)
