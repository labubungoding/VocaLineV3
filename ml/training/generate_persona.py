"""Membuat DRAF contoh percakapan persona dengan Gemini, untuk diperiksa tim.

    python training/generate_persona.py --persona lansia --emosi marah --jumlah 10

Hasil ditulis ke data/persona/draft_<persona>.jsonl (BUKAN langsung ke file utama).
Alur kerja:
1. Jalankan skrip ini.
2. Baca dan perbaiki draf. Hapus yang tidak wajar.
3. Jalankan: python training/validate_persona.py --file data/persona/draft_lansia.jsonl
4. Pindahkan baris yang lolos ke data/persona/lansia.jsonl.

Butuh GEMINI_API_KEY di .env. Situasi yang sudah ada otomatis dihindari supaya tidak dobel.
"""
from __future__ import annotations

import argparse
import json

from common import ROOT


def main() -> None:
    from google import genai
    from google.genai import types

    from config.settings import get_settings
    from src.conversation.persona import prompt_persona

    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", choices=["remaja", "dewasa", "lansia"], required=True)
    ap.add_argument("--emosi", choices=["ceria", "sedih", "marah", "netral"], required=True)
    ap.add_argument("--jumlah", type=int, default=10)
    a = ap.parse_args()

    s = get_settings()
    if not s.gemini_api_key:
        raise SystemExit("GEMINI_API_KEY belum diisi di .env")

    utama = ROOT / "data/persona" / f"{a.persona}.jsonl"
    situasi_lama = sorted({json.loads(b)["situasi"] for b in utama.read_text(encoding="utf-8").splitlines() if b.strip()})
    panduan = (ROOT / "data/persona/README.md").read_text(encoding="utf-8")

    instruksi = f"""Kamu membantu membuat dataset contoh percakapan untuk Vine, AI teman ngobrol pasien rawat inap.
Ikuti panduan berikut dengan ketat:

{panduan}

Gaya persona:
{prompt_persona(a.persona)}

Buat {a.jumlah} contoh BARU untuk persona "{a.persona}" dengan emosi pasien "{a.emosi}".
Situasi yang SUDAH ADA dan tidak boleh dipakai lagi: {", ".join(situasi_lama)}.
Kalimat pasien harus terdengar seperti ucapan sehari-hari pasien rumah sakit di Indonesia.
Jawab HANYA dengan JSON array berisi objek dengan field: persona, situasi, emosi, pasien, ai."""

    client = genai.Client(api_key=s.gemini_api_key)
    resp = client.models.generate_content(
        model=s.gemini_model.split(",")[0].strip(), contents=instruksi,
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.9),
    )
    data = json.loads(resp.text)
    out = ROOT / "data/persona" / f"draft_{a.persona}.jsonl"
    with open(out, "a", encoding="utf-8") as f:
        for d in data:
            d["persona"], d["emosi"] = a.persona, a.emosi
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    print(f"{len(data)} draf ditambahkan ke {out}. Periksa dulu sebelum dipindahkan ke {utama.name}.")


if __name__ == "__main__":
    main()
