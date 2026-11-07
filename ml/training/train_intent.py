"""Fine-tune IndoBERT untuk klasifikasi maksud (darurat, bantuan, pertanyaan_medis, perintah, ngobrol).

Jalankan di Colab/Kaggle setelah prepare_data.py --task intent.
    python training/train_intent.py
    python training/train_intent.py --epoch 8 --model indobenchmark/indobert-lite-base-p1
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
    train("intent", a.model, a.epoch, a.lr, a.batch)
