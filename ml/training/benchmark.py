"""Mengukur kecepatan ml-service di laptop, sebelum demo.

    python training/benchmark.py                 # tanpa Gemini (hemat kuota)
    python training/benchmark.py --pakai-gemini  # termasuk waktu Gemini (memakai kuota!)
    python training/benchmark.py --ulang 5

Yang diukur:
- Jalur teks: aturan + model maksud + model emosi + balasan (tanpa Whisper).
- Jalur audio: rekaman di data/stt_test/*.wav, termasuk VAD dan Whisper (jika ada rekaman).
Target wajar untuk demo: jalur audio di bawah 3 detik per ucapan pendek.
"""
from __future__ import annotations

import argparse
import base64
import statistics
import time

from common import ROOT, simpan_laporan


def ringkas(nama: str, waktu: list[float]) -> dict:
    waktu = sorted(waktu)
    p95 = waktu[min(len(waktu) - 1, int(round(0.95 * (len(waktu) - 1))))]
    hasil = {"jumlah": len(waktu), "rata_rata_ms": statistics.mean(waktu) * 1000, "p95_ms": p95 * 1000,
             "maks_ms": waktu[-1] * 1000}
    print(f"{nama:<14} n={hasil['jumlah']:<4} rata-rata {hasil['rata_rata_ms']:7.0f} ms   "
          f"p95 {hasil['p95_ms']:7.0f} ms   maks {hasil['maks_ms']:7.0f} ms")
    return hasil


def main() -> None:
    import pandas as pd

    from src.pipeline import VinePipeline

    ap = argparse.ArgumentParser()
    ap.add_argument("--pakai-gemini", action="store_true")
    ap.add_argument("--ulang", type=int, default=3)
    a = ap.parse_args()

    mulai = time.perf_counter()
    p = VinePipeline(muat_suara=True)
    print(f"Memuat semua model: {time.perf_counter() - mulai:.1f} detik")
    print("Komponen:", p.status())
    if not a.pakai_gemini:
        p.chat.utama = p.chat.template

    kalimat = pd.read_csv(ROOT / "data/test_cases/uji_realistis_intent.csv")["teks"].tolist()
    p.process_text("pemanasan", "halo", 0.95, 40, "dewasa")

    waktu_teks = []
    for i in range(a.ulang):
        for t in kalimat:
            m = time.perf_counter()
            p.process_text(f"bench-{i}", t, 0.95, 70, "lansia", nama_panggilan="Pak Uji")
            waktu_teks.append(time.perf_counter() - m)
    hasil = {"teks": ringkas("Jalur teks", waktu_teks)}

    rekaman = sorted((ROOT / "data/stt_test").glob("*.wav"))
    if rekaman and p.stt and p.stt.aktif:
        waktu_audio = []
        for f in rekaman:
            b64 = base64.b64encode(f.read_bytes()).decode()
            m = time.perf_counter()
            p.process_audio("bench-audio", b64, 70, "lansia", 0, "Pak Uji")
            waktu_audio.append(time.perf_counter() - m)
        hasil["audio"] = ringkas("Jalur audio", waktu_audio)
    else:
        print("Jalur audio dilewati: belum ada rekaman di data/stt_test/ atau Whisper tidak aktif.")

    print(f"Laporan: {simpan_laporan('benchmark', hasil)}")


if __name__ == "__main__":
    main()
