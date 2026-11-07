"""Mengukur Whisper pada rekaman suara tim dan menyarankan ambang keyakinan.

Siapkan:
    data/stt_test/transkrip.csv  -> kolom: file,teks   (teks = kalimat yang benar-benar diucapkan)
    data/stt_test/*.wav          -> rekaman 16 kHz mono (format lain akan dikonversi otomatis)

Jalankan di laptop (tempat ml-service berjalan, supaya kecepatannya realistis):
    python training/evaluate_stt.py --model small
    python training/evaluate_stt.py --model base

Hasil:
- WER (Word Error Rate) rata-rata: persentase kata yang salah. Makin kecil makin baik.
- Waktu proses rata-rata per rekaman di CPU.
- Saran nilai stt.min_keyakinan: ambang yang paling baik memisahkan transkrip bagus (WER <= 0.3)
  dari transkrip buruk. Salin ke config/thresholds.yaml.
"""
from __future__ import annotations

import argparse
import re
import time

from common import ROOT, simpan_laporan


def wer(referensi: str, hipotesis: str) -> float:
    from src.intent.safety_rules import normalisasi

    r, h = normalisasi(referensi).split(), normalisasi(hipotesis).split()
    if not r:
        return 0.0 if not h else 1.0
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / len(r)


def saran_ambang(data: list[tuple[float, float]], batas_wer: float = 0.3) -> tuple[float, float]:
    """data = [(keyakinan, wer)]. Mencari ambang dengan akurasi pemisahan bagus/buruk tertinggi."""
    terbaik, akurasi_terbaik = 0.5, -1.0
    for i in range(5, 96):
        am = i / 100
        benar = sum((k >= am) == (w <= batas_wer) for k, w in data)
        if benar / len(data) > akurasi_terbaik:
            terbaik, akurasi_terbaik = am, benar / len(data)
    return terbaik, akurasi_terbaik


def main() -> None:
    import pandas as pd

    from src.speech.audio_utils import load_audio
    from src.speech.stt import SpeechToText

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small", help="tiny, base, atau small")
    a = ap.parse_args()

    folder = ROOT / "data/stt_test"
    df = pd.read_csv(folder / "transkrip.csv")
    from config.settings import get_thresholds

    cfg = get_thresholds()["stt"]
    stt = SpeechToText(a.model, cfg.get("prompt_awal", ""), cfg.get("halusinasi", []))
    if not stt.aktif:
        raise SystemExit("faster-whisper belum terpasang")

    baris, waktu = [], []
    ada = df["file"].map(lambda f: (folder / f).exists())
    if not ada.all():
        print(f"Melewati {int((~ada).sum())} file yang belum direkam.")
    df = df[ada]
    if df.empty:
        raise SystemExit("Belum ada rekaman di data/stt_test/. Lihat data/stt_test/README.md")
    for _, r in df.iterrows():
        audio = load_audio((folder / r["file"]).read_bytes())
        mulai = time.perf_counter()
        hasil = stt.transcribe(audio)
        waktu.append(time.perf_counter() - mulai)
        w = wer(r["teks"], hasil.teks)
        baris.append({"file": r["file"], "asli": r["teks"], "whisper": hasil.teks,
                      "keyakinan": round(hasil.keyakinan, 3), "wer": round(w, 3)})
        print(f"[{w:.2f} | yakin {hasil.keyakinan:.2f}] {r['teks']}  ->  {hasil.teks}")

    rata_wer = sum(b["wer"] for b in baris) / len(baris)
    kelompok: dict[str, list[float]] = {}
    for b in baris:
        kelompok.setdefault(re.match(r"[a-z]+", b["file"].lower()).group(), []).append(b["wer"])
    print("\nWER per kelompok:")
    for k, ws in kelompok.items():
        print(f"  {k:<8} {sum(ws) / len(ws):.3f}  ({len(ws)} rekaman)")
    ambang, akurasi = saran_ambang([(b["keyakinan"], b["wer"]) for b in baris])
    print(f"\nWhisper {a.model}: WER rata-rata {rata_wer:.3f}, waktu rata-rata {sum(waktu) / len(waktu):.2f} detik")
    print(f"Saran stt.min_keyakinan: {ambang} (memisahkan transkrip bagus/buruk dengan akurasi {akurasi:.2f})")
    print(f"Laporan: {simpan_laporan(f'evaluasi_stt_{a.model}', {'wer': rata_wer, 'ambang': ambang, 'detail': baris})}")


if __name__ == "__main__":
    main()
