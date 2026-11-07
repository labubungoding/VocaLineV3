"""Persiapan model wake word "Vine on" dan "Vine off".

Wake word berjalan di BROWSER tablet, bukan di ml-service. Dua pilihan:

A. Porcupine (Picovoice), paling mudah:
   1. Daftar di console.picovoice.ai, buat AccessKey.
   2. Buat keyword "Vine on" dan "Vine off" di Porcupine console, platform "Web (WASM)".
   3. Unduh file .ppn, serahkan ke tim frontend bersama AccessKey.
   4. Frontend memakai paket @picovoice/porcupine-web.
   Uji dengan rekaman di data/wakeword/ sebelum demo.

B. openWakeWord, sepenuhnya open-source:
   1. Latih model custom memakai notebook pelatihan openWakeWord di Colab.
   2. Ekspor ke ONNX.
   3. Frontend menjalankannya dengan onnxruntime-web.
   Lebih fleksibel, tapi butuh usaha lebih.

Skrip ini memeriksa kelengkapan rekaman uji di data/wakeword/.
"""
from __future__ import annotations

from common import ROOT


def main() -> None:
    folder = ROOT / "data" / "wakeword"
    for bagian, target in (("positif", 200), ("negatif", 100)):
        files = [f for f in (folder / bagian).glob("*.wav")]
        status = "cukup" if len(files) >= target else f"kurang {target - len(files)}"
        print(f"{bagian}: {len(files)} rekaman (target {target}, {status})")
    print("\nPetunjuk lengkap ada di docstring file ini dan data/wakeword/README.md")


if __name__ == "__main__":
    main()
