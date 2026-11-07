"""Sebelum/sesudah pemeriksa konteks alarm pada data/test_cases/uji_konteks_alarm.csv.

    python training/evaluate_konteks_alarm.py          # tabel ringkas
    python training/evaluate_konteks_alarm.py --salah  # juga daftar kalimat yang salah

Harapan per kalimat: hijau (curhat), naik (darurat/bantuan nyata), tanya (ambigu), langsung (permintaan eksplisit
/ bunuh diri). "Sebelum" = kata_darurat + IndoBERT + penurun_level (konteks_alarm dimatikan). Tanpa LLM.
Hasil per kalimat: alarm (level oranye/merah), tanya (Vine bertanya konfirmasi), atau hijau.
- alarm palsu  = harapan hijau, hasil alarm
- darurat lolos = harapan naik/langsung, hasil bukan alarm (tanya juga dihitung lolos: alarm tertunda)
"""
import csv
import logging
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("VINE_TANPA_SUARA", "1")

from src.pipeline import VinePipeline

logging.getLogger("vine-ml").setLevel(logging.ERROR)


def hasil(p: VinePipeline, i: int, teks: str) -> tuple[str, str]:
    id_kasur = f"eval-konteks-{i}"
    p.reset(id_kasur)
    a = p._analisa(id_kasur, teks, 1.0, 70, "lansia", 0, "Pak Yusuf")
    p.reset(id_kasur)
    ka = a.konteks_alarm
    if ka is not None and ka.keputusan == "tanya" and a.level_lokal == "hijau":
        return "tanya", ka.keputusan
    return ("alarm" if a.level_lokal != "hijau" else "hijau"), (ka.keputusan if ka else "-")


def main(tampil_salah: bool = False) -> dict:
    baris = list(csv.DictReader(open(ROOT / "data" / "test_cases" / "uji_konteks_alarm.csv", encoding="utf-8")))
    p = VinePipeline(muat_suara=False)
    aktif = p.konteks_alarm.aktif
    for b, (i, _) in zip(baris, enumerate(baris)):
        p.konteks_alarm.aktif = False
        b["sebelum"], _ = hasil(p, i, b["teks"])
        p.konteks_alarm.aktif = True
        b["sesudah"], b["keputusan"] = hasil(p, i, b["teks"])
    p.konteks_alarm.aktif = aktif

    jumlah = defaultdict(lambda: defaultdict(int))
    for b in baris:
        h, kat = b["harapan"], b["pemicu"]
        for fase in ("sebelum", "sesudah"):
            r = b[fase]
            if h == "hijau":
                jumlah[kat][f"palsu_{fase}"] += r == "alarm"
                jumlah[kat][f"tanya_curhat_{fase}"] += r == "tanya"
            elif h in ("naik", "langsung"):
                jumlah[kat][f"lolos_{fase}"] += r != "alarm"
            elif h == "tanya":
                jumlah[kat][f"tanya_ok_{fase}"] += r == "tanya"
                jumlah[kat][f"tanya_hijau_{fase}"] += r == "hijau"
        jumlah[kat][f"n_{h}"] += 1

    def total(k):
        return sum(v[k] for v in jumlah.values())

    n = {h: sum(b["harapan"] == h for b in baris) for h in ("hijau", "naik", "tanya", "langsung")}
    print(f"{len(baris)} kalimat: {n['hijau']} curhat (harus hijau), {n['naik']} nyata (harus naik), "
          f"{n['tanya']} ambigu (harus tanya), {n['langsung']} permintaan/bunuh diri (harus langsung)\n")
    print(f"{'pemicu':9s} | {'curhat':>6s} {'alarm palsu':>15s} | {'nyata+langsung':>14s} {'lolos':>9s} | "
          f"{'ambigu':>6s} {'ditanya':>9s}")
    print(f"{'':9s} | {'':>6s} {'sblm -> ssdh':>15s} | {'':>14s} {'sblm->ssdh':>9s} | {'':>6s} {'sblm->ssdh':>9s}")
    for kat in sorted(jumlah):
        v = jumlah[kat]
        print(f"{kat:9s} | {v['n_hijau']:6d} {v['palsu_sebelum']:7d} -> {v['palsu_sesudah']:<5d} | "
              f"{v['n_naik'] + v['n_langsung']:14d} {v['lolos_sebelum']:3d} -> {v['lolos_sesudah']:<3d} | "
              f"{v['n_tanya']:6d} {v['tanya_ok_sebelum']:3d} -> {v['tanya_ok_sesudah']:<3d}")
    print(f"{'TOTAL':9s} | {n['hijau']:6d} {total('palsu_sebelum'):7d} -> {total('palsu_sesudah'):<5d} | "
          f"{n['naik'] + n['langsung']:14d} {total('lolos_sebelum'):3d} -> {total('lolos_sesudah'):<3d} | "
          f"{n['tanya']:6d} {total('tanya_ok_sebelum'):3d} -> {total('tanya_ok_sesudah'):<3d}")
    langsung_ok = sum(b["sesudah"] == "alarm" and b["keputusan"] == "langsung" for b in baris
                      if b["harapan"] == "langsung")
    print(f"\nCurhat yang sekarang ditanya (bukan alarm, bukan hijau): {total('tanya_curhat_sesudah')}")
    print(f"Ambigu yang sekarang hijau tanpa ditanya: {total('tanya_hijau_sesudah')}")
    print(f"Permintaan/bunuh diri dengan keputusan 'langsung': {langsung_ok}/{n['langsung']}")
    salah = [b for b in baris if (b["harapan"] == "hijau" and b["sesudah"] != "hijau")
             or (b["harapan"] in ("naik", "langsung") and b["sesudah"] != "alarm")
             or (b["harapan"] == "tanya" and b["sesudah"] != "tanya")]
    print(f"Tidak sesuai harapan (sesudah): {len(salah)}")
    if tampil_salah:
        for b in salah:
            print(f"  harap {b['harapan']:8s} dapat {b['sesudah']:6s} ({b['keputusan']}): {b['teks']}")
    return {"palsu": total("palsu_sesudah"), "lolos": total("lolos_sesudah"), "salah": salah, "baris": baris}


if __name__ == "__main__":
    main("--salah" in sys.argv)
