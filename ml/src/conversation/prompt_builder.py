"""Menyusun prompt LLM yang RINGKAS.

`susun()`: system prompt (target < 350 token), dirakit dari config/gaya_bicara.yaml (bisa diubah tanpa menyentuh
kode): identitas + aturan inti, panjang balasan, sapaan per persona, aturan perawat sesuai level, gaya persona x emosi,
maksud + level lokal, pembuka yang baru dipakai, contoh (jika ada), dan format jawaban.

`susun_pesan()`: pesan pengguna berisi memori percakapan: topik aktif (ringkasan + giliran), 1 baris topik lama,
fakta pasien, lalu ucapan terakhir. Tanpa pelacak topik (mis. di tes), riwayat terakhir yang dipakai.
"""
from __future__ import annotations

import math
from functools import lru_cache

import yaml

from config.settings import ROOT
from src.conversation.fewshot import pilih_contoh
from src.conversation.persona import bersihkan_panggilan, isi_panggilan
from src.conversation.pasca_proses import pembuka, sapaan_hormat

EKSPRESI = "senang/antusias/empati/tenang/bercanda/serius/netral"
CATATAN_FIELD = f"ekspresi: {EKSPRESI}; alasan: gejala jika naik; ingat: fakta baru"

FORMAT_JSON = (
    f"Jawab HANYA JSON: balasan; level; ekspresi ({EKSPRESI}); alasan (gejala jika naik); "
    "ingat (fakta baru, mis. 3 cucu); ringkasan (maks 8 kata)."
)
MAKS_KARAKTER_INGATAN = 100
FORMAT_STREAM = (
    f"Baris 1 HANYA [[level=..;ekspresi=..;alasan=..;ingat=..]] ({CATATAN_FIELD}).\nBaris 2: kalimat Vine."
)


@lru_cache
def muat_gaya() -> dict:
    with open(ROOT / "config" / "gaya_bicara.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def maks_kata(persona: str) -> int:
    return int(muat_gaya()["persona"].get(persona, {}).get("maks_kata", 18))


def panjang(persona: str) -> dict:
    """Aturan panjang balasan level hijau untuk persona (config/gaya_bicara.yaml, bagian `persona`)."""
    g = muat_gaya()["persona"]
    per = g.get(persona) or g["dewasa"]
    kal, kata = per.get("kalimat", [2, 3]), per.get("kata", [25, 45])
    return {"kalimat": (int(kal[0]), int(kal[1])), "kata": (int(kata[0]), int(kata[1])),
            "maks_kata": int(per.get("maks_kata", 18)), "maks_token": int(per.get("maks_token", 320))}


def aturan_alarm() -> dict:
    """Merah/oranye: total kalimat (termasuk kalimat alarm) dan batas token jawaban LLM."""
    a = muat_gaya().get("alarm", {})
    return {"maks_kalimat": int(a.get("maks_kalimat", 2)), "maks_token": int(a.get("maks_token", 160))}


def maks_token(k) -> int:
    """max_output_tokens untuk konteks ini: singkat saat merah/oranye, sesuai persona saat hijau."""
    if getattr(k, "alarm_terucap", "") or k.level_lokal != "hijau":
        return aturan_alarm()["maks_token"]
    return panjang(k.persona)["maks_token"]


def perkiraan_token(teks: str) -> int:
    """Perkiraan jumlah token system prompt: sekitar 3 karakter per token, dibulatkan ke atas.

    Dikalibrasi dengan usage.prompt_tokens dari Groq (openai/gpt-oss-20b), November 2026:
    prompt 1.100 karakter = sekitar 355 token. Sengaja sedikit melebihkan supaya batas di tes aman.
    """
    return math.ceil(len(teks) / 3.0)


def pilih_fakta(fakta: list[str], maks_karakter: int = MAKS_KARAKTER_INGATAN) -> list[str]:
    """Fakta terbaru yang muat dalam batas karakter, urutan aslinya dipertahankan."""
    terpilih, panjang = [], 0
    for f in reversed(list(fakta)):
        if panjang + len(f) + 2 > maks_karakter and terpilih:
            break
        terpilih.append(f)
        panjang += len(f) + 2
    return terpilih[::-1]


def susun(k, stream: bool = False) -> str:
    """`k` adalah KonteksBalasan (src/conversation/chat.py)."""
    g = muat_gaya()
    nama = bersihkan_panggilan(k.nama_panggilan) or ("kamu" if k.persona == "remaja" else "Bapak/Ibu")
    per = g["persona"].get(k.persona, g["persona"]["dewasa"])
    pj = panjang(k.persona)
    mk = pj["maks_kata"]
    alarm = getattr(k, "alarm_terucap", "")
    aturan = list(g["aturan"])
    ditanya = _ditanya(k)
    if ditanya:
        aturan[0] = g["ingatan"]["ditanya"]
    aturan.append(g["panjang"]["alarm" if alarm or k.level_lokal != "hijau" else "hijau"])
    isi = {"maks_kata": mk, "kalimat": "{}-{}".format(*pj["kalimat"]), "kata": "{}-{}".format(*pj["kata"])}
    baris = [g["identitas"]]
    baris += [f"- {a.format(**isi)}" for a in aturan]
    baris.append(f"- {per['sapaan'].format(nama=nama, hormat=sapaan_hormat(nama, k.persona))}")

    tambahan = g.get("maksud", {}).get(k.maksud) if not alarm else None
    if tambahan:
        tambahan = tambahan.format(nama=nama, hormat=sapaan_hormat(nama, k.persona))
    hijau = k.level_lokal == "hijau"
    if alarm:
        baris += [f"- {g['perawat']['sudah_diucapkan'].format(alarm=alarm)}", f"- {g['medis_setelah_alarm']}"]
    elif tambahan:
        baris += [f"- {g['perawat']['hijau']}"] * hijau + [f"- {tambahan}"]
    else:
        baris.append(f"- {g['medis_hijau'] if hijau else g['medis']}")
    fakta = pilih_fakta(getattr(k, "fakta", []) or [])
    if not alarm and not fakta and not ditanya:
        ingatan = g.get("ingatan", {}).get("ada" if getattr(k, "riwayat", None) else "kosong")
        if ingatan:
            baris.append(f"- {ingatan}")

    gaya = g["gaya"].get(k.persona, {}).get(k.emosi) or g["gaya"]["dewasa"]["netral"]
    pembuka_baru = [p for p in (getattr(k, "pembuka_terakhir", []) or []) if p]
    saran = [p for p in gaya["pembuka"] if pembuka(p) not in pembuka_baru] or gaya["pembuka"]
    if not alarm:
        mis = "" if pembuka_baru else f' mis. "{saran[0]}";'
        baris.append(f"Pasien {k.emosi}: {gaya['nada']};{mis} hindari {gaya['hindari']}.")
    else:
        baris.append(f"Pasien {k.emosi}.")
    baris.append(f"Maksud {k.maksud}, level {k.level_lokal}."
                 + (f" {g['level']}" if k.level_lokal != "merah" and not tambahan else ""))

    if pembuka_baru:
        baris.append("Hindari pembuka: " + ", ".join(f'"{p}"' for p in pembuka_baru[-3:]) + ".")

    awal = not (getattr(k, "riwayat", None) or fakta)
    contoh = pilih_contoh(k.persona, k.emosi, k.jumlah_contoh + 5) if awal and not (alarm or tambahan) else []
    contoh = [c for c in sorted(contoh, key=lambda c: len(c["ai"])) if len(c["ai"]) <= 70][: k.jumlah_contoh]
    if contoh:
        baris.append("Contoh gaya: " + " | ".join(isi_panggilan(c["ai"], nama) for c in contoh))

    baris.append(FORMAT_STREAM if stream else FORMAT_JSON)
    return "\n".join(baris)


def _ditanya(k) -> bool:
    """Pasien menanyakan hal lama ("kamu ingat ...?") dan ingatan/riwayat ada.

    Aturan "jangan ulang topik lama" justru membuat model menghindari jawabannya (demo 3B, Groq),
    jadi diganti perintah menjawab dari ingatan.
    """
    return (not getattr(k, "alarm_terucap", "") and bool(getattr(k, "fakta", None) or getattr(k, "riwayat", None))
            and "ingat" in k.teks_pasien.lower())


def susun_pesan(k) -> str:
    """Pesan pengguna: memori percakapan lalu ucapan terakhir, ditandai jelas supaya LLM menanggapi ucapan itu."""
    g = muat_gaya()
    baris = []
    topik = getattr(k, "topik", None)
    if topik:
        tanda = {"lanjut": "", "kembali": " (pasien kembali ke topik ini)", "baru": " (topik baru)"}
        baris.append(f"Topik sekarang{tanda.get(topik.get('status'), '')}: {topik['aktif']}.")
        if topik.get("lama"):
            baris.append("Topik lama (ungkit hanya jika pasien kembali): " + "; ".join(topik["lama"]) + ".")
    fakta = pilih_fakta(getattr(k, "fakta", []) or [])
    if fakta:
        catatan = "" if _ditanya(k) else f" ({g['ingatan']['dengan_fakta']})"
        baris.append(f"Ingatan pasien{catatan}: " + "; ".join(fakta) + ".")
    giliran = topik.get("giliran", []) if topik else list(getattr(k, "riwayat", []) or [])
    if giliran:
        baris.append("Obrolan topik ini:" if topik else "Riwayat:")
        for pasien, vine in giliran:
            baris.append(f"Pasien: {pasien}\nVine: {vine}")
    baris.append(f"UCAPAN TERAKHIR PASIEN (tanggapi ini): {k.teks_pasien}")
    return "\n".join(baris)
