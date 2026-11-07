"""Mengunduh model sentence-embedding untuk deteksi topik ke models/topik-minilm (sekali saja, butuh internet).

    python training/siapkan_model_topik.py

Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (multilingual termasuk Indonesia, sekitar
470 MB, sekitar 30 ms per kalimat di CPU laptop). Dipilih karena lebih akurat daripada mean pooling IndoBERT
maksud untuk membedakan topik (lihat training/evaluate_topik.py). Server memuatnya dari folder lokal, tanpa internet.
Jika folder ini tidak ada, server memakai IndoBERT maksud sebagai cadangan (lebih lemah).
"""
from pathlib import Path

from transformers import AutoModel, AutoTokenizer

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
TUJUAN = Path(__file__).resolve().parent.parent / "models" / "topik-minilm"

if __name__ == "__main__":
    TUJUAN.mkdir(parents=True, exist_ok=True)
    AutoTokenizer.from_pretrained(MODEL).save_pretrained(TUJUAN)
    AutoModel.from_pretrained(MODEL).save_pretrained(TUJUAN)
    print(f"Model topik tersimpan di {TUJUAN}")
