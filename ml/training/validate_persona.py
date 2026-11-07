"""Memeriksa dataset persona (data/persona/*.jsonl) sebelum dipakai.

    python training/validate_persona.py
    python training/validate_persona.py --file data/persona/draft_lansia.jsonl

Yang diperiksa (sesuai data/persona/README.md):
- format JSON per baris dan field wajib lengkap
- persona dan emosi valid
- balasan maksimal 2 kalimat dan 1 pertanyaan, tanpa emoji, tanpa "saya temani"
- lansia maksimal 15 kata per kalimat; lansia/dewasa tidak memakai "Anda"
- tidak mengklaim perawat sedang datang/sudah dipanggil (contoh persona selalu level hijau)
- field ekspresi wajib dan valid
- {panggilan} paling banyak sekali
- tidak ada saran medis (memakai guardrails yang sama dengan server)
- tidak ada kalimat pasien yang dobel
Mengembalikan kode keluar 1 jika ada kesalahan, supaya bisa dipakai di tes otomatis.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

from common import ROOT

FIELD = ("persona", "situasi", "emosi", "pasien", "ai", "ekspresi")
EKSPRESI = ("senang", "antusias", "empati", "tenang", "bercanda", "serius", "netral")
EMOSI = ("ceria", "sedih", "marah", "netral")
PERSONA = ("remaja", "dewasa", "lansia")
EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF]")


def periksa_file(path: Path) -> tuple[list[str], Counter]:
    from src.conversation.guardrails import aman
    from src.conversation.pasca_proses import klaim_perawat

    galat, emosi, sudah = [], Counter(), set()
    persona_file = next((p for p in PERSONA if p in path.stem), None)
    for no, baris in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not baris.strip():
            galat.append(f"{path.name}:{no} baris kosong")
            continue
        try:
            d = json.loads(baris)
        except json.JSONDecodeError as e:
            galat.append(f"{path.name}:{no} JSON rusak ({e.msg})")
            continue
        kurang = [f for f in FIELD if not str(d.get(f, "")).strip()]
        if kurang:
            galat.append(f"{path.name}:{no} field kosong: {', '.join(kurang)}")
            continue
        if d["persona"] not in PERSONA or (persona_file and d["persona"] != persona_file):
            galat.append(f"{path.name}:{no} persona '{d['persona']}' tidak sesuai nama file")
        if d["emosi"] not in EMOSI:
            galat.append(f"{path.name}:{no} emosi '{d['emosi']}' tidak valid")
        ai = d["ai"]
        kalimat = [k for k in re.split(r"(?<=[.!?])\s+", ai.strip()) if k]
        if len(kalimat) > 2:
            galat.append(f"{path.name}:{no} balasan {len(kalimat)} kalimat (maks 2)")
        if ai.count("?") > 1:
            galat.append(f"{path.name}:{no} lebih dari 1 pertanyaan")
        if d["persona"] == "lansia" and any(len(k.split()) > 15 for k in kalimat):
            galat.append(f"{path.name}:{no} kalimat lansia lebih dari 15 kata")
        if d["persona"] in ("lansia", "dewasa") and re.search(r"anda", ai, re.I):
            galat.append(f"{path.name}:{no} memakai 'Anda' (pakai nama panggilan atau Bapak/Ibu)")
        if klaim_perawat(ai):
            galat.append(f"{path.name}:{no} mengklaim perawat datang/dipanggil")
        if d["ekspresi"] not in EKSPRESI:
            galat.append(f"{path.name}:{no} ekspresi '{d['ekspresi']}' tidak valid")
        if EMOJI.search(ai):
            galat.append(f"{path.name}:{no} ada emoji")
        if "temani" in ai.lower():
            galat.append(f"{path.name}:{no} memakai kata 'temani'")
        if ai.count("{panggilan}") > 1:
            galat.append(f"{path.name}:{no} {{panggilan}} lebih dari sekali")
        if re.search(r"\{(?!panggilan\})[^}]*\}", ai):
            galat.append(f"{path.name}:{no} penanda tidak dikenal, hanya {{panggilan}} yang boleh")
        if not aman(ai):
            galat.append(f"{path.name}:{no} terdeteksi saran medis")
        kunci = d["pasien"].strip().lower()
        if kunci in sudah:
            galat.append(f"{path.name}:{no} kalimat pasien dobel")
        sudah.add(kunci)
        emosi[d["emosi"]] += 1
    return galat, emosi


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path, nargs="*")
    a = ap.parse_args()
    files = a.file or sorted((ROOT / "data/persona").glob("*.jsonl"))
    total_galat = 0
    for f in files:
        galat, emosi = periksa_file(f)
        total_galat += len(galat)
        status = "OK" if not galat else f"{len(galat)} masalah"
        print(f"{f.name}: {sum(emosi.values())} contoh {dict(emosi)} -> {status}")
        for g in galat:
            print(f"  - {g}")
    return 1 if total_galat else 0


if __name__ == "__main__":
    sys.exit(main())
