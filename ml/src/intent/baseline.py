"""Model pembanding: TF-IDF (kata + karakter) + Logistic Regression.

Kegunaan:
1. Cadangan selama IndoBERT belum dilatih. Jauh lebih baik daripada daftar kata kunci.
2. Pembanding akurasi: di presentasi, IndoBERT harus terbukti lebih baik dari model ini.

Dilatih dalam hitungan detik di CPU laptop dengan training/train_baseline.py.
"""
from __future__ import annotations

from pathlib import Path

from src.intent.safety_rules import normalisasi


def buat_pipeline():
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import FeatureUnion, Pipeline

    fitur = FeatureUnion([
        ("kata", TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)),
        ("karakter", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=1, sublinear_tf=True)),
    ])
    return Pipeline([
        ("fitur", fitur),
        ("klasifikasi", LogisticRegression(max_iter=2000, C=8.0, class_weight="balanced")),
    ])


class BaselineClassifier:
    def __init__(self, path: Path):
        import joblib

        self.model = joblib.load(path)
        self.labels = list(self.model.classes_)

    def predict_proba(self, teks: str) -> dict[str, float]:
        probs = self.model.predict_proba([normalisasi(teks)])[0]
        return {lb: float(p) for lb, p in zip(self.labels, probs)}
