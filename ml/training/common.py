"""Fungsi bersama untuk melatih dan mengevaluasi IndoBERT (maksud dan emosi).

Jalankan di Google Colab atau Kaggle dengan GPU. Di CPU laptop akan sangat lambat.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TUGAS = {
    "intent": {
        "raw": ROOT / "data/intent/raw/kalimat_pasien.csv",
        "processed": ROOT / "data/intent/processed",
        "model_dir": ROOT / "models/indobert-intent",
        "baseline": ROOT / "models/baseline-intent.joblib",
        "uji_realistis": ROOT / "data/test_cases/uji_realistis_intent.csv",
        "labels": ["darurat", "bantuan", "pertanyaan_medis", "perintah", "ngobrol"],
    },
    "emotion": {
        "raw": ROOT / "data/emotion/raw/kalimat_emosi.csv",
        "processed": ROOT / "data/emotion/processed",
        "model_dir": ROOT / "models/indobert-emotion",
        "baseline": ROOT / "models/baseline-emotion.joblib",
        "uji_realistis": ROOT / "data/test_cases/uji_realistis_emosi.csv",
        "labels": ["ceria", "sedih", "marah", "netral"],
    },
}

MODEL_DASAR = "indobenchmark/indobert-base-p1"


def bersihkan(teks: str) -> str:
    return " ".join(str(teks).strip().split())


def train(tugas: str, model_dasar: str = MODEL_DASAR, epoch: int = 5, lr: float = 2e-5, batch: int = 16) -> None:
    import numpy as np
    import pandas as pd
    from datasets import Dataset
    from sklearn.metrics import accuracy_score, f1_score
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        DataCollatorWithPadding,
        Trainer,
        TrainingArguments,
    )

    cfg = TUGAS[tugas]
    labels = cfg["labels"]
    label2id = {lb: i for i, lb in enumerate(labels)}
    id2label = {i: lb for lb, i in label2id.items()}

    train_df = pd.read_csv(cfg["processed"] / "train.csv")
    val_df = pd.read_csv(cfg["processed"] / "val.csv")

    tok = AutoTokenizer.from_pretrained(model_dasar)

    def siapkan(df):
        ds = Dataset.from_pandas(pd.DataFrame({"text": df["teks"], "label": df["label"].map(label2id)}))
        return ds.map(lambda b: tok(b["text"], truncation=True, max_length=64), batched=True)

    model = AutoModelForSequenceClassification.from_pretrained(
        model_dasar, num_labels=len(labels), id2label=id2label, label2id=label2id
    )

    def metrik(pred):
        y_pred = np.argmax(pred.predictions, axis=-1)
        return {"akurasi": accuracy_score(pred.label_ids, y_pred), "f1_makro": f1_score(pred.label_ids, y_pred, average="macro")}

    args = TrainingArguments(
        output_dir=str(ROOT / "reports" / f"checkpoint-{tugas}"),
        num_train_epochs=epoch,
        learning_rate=lr,
        per_device_train_batch_size=batch,
        per_device_eval_batch_size=batch,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1_makro",
        save_total_limit=1,
        logging_steps=10,
        report_to=[],
    )
    trainer = Trainer(
        model=model, args=args, train_dataset=siapkan(train_df), eval_dataset=siapkan(val_df),
        data_collator=DataCollatorWithPadding(tok), compute_metrics=metrik,
    )
    trainer.train()
    cfg["model_dir"].mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(cfg["model_dir"]))
    tok.save_pretrained(str(cfg["model_dir"]))
    print(f"Model tersimpan di {cfg['model_dir']}")


def muat_model(tugas: str, jenis: str = "indobert"):
    """jenis = "indobert" (models/indobert-*) atau "pembanding" (models/baseline-*.joblib)."""
    if jenis == "pembanding":
        from src.intent.baseline import BaselineClassifier

        return BaselineClassifier(TUGAS[tugas]["baseline"])
    from src.intent.indobert_classifier import HFTextClassifier

    return HFTextClassifier(TUGAS[tugas]["model_dir"])


def simpan_laporan(nama: str, isi: dict) -> Path:
    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    path = out / f"{nama}.json"
    path.write_text(json.dumps(isi, indent=2, ensure_ascii=False), encoding="utf-8")
    return path
