"""Pengaturan suara Vine di browser (config/suara.yaml) untuk GET /pengaturan-suara.

Frontend (tablet dan halaman uji /demo) memuat ini saat start dan tidak menulis angka suara/VAD sendiri.
File dibaca ulang setiap permintaan, jadi perubahan langsung terpakai setelah halaman dimuat ulang.
"""
from __future__ import annotations

import yaml

from config.settings import ROOT, get_thresholds

PERSONA = ("remaja", "dewasa", "lansia")
EKSPRESI = ("senang", "antusias", "empati", "tenang", "bercanda", "serius", "netral")


class PengaturanSuaraTidakValid(ValueError):
    pass


def _angka(nilai, nama: str, minimum: float = 0, maksimum: float | None = None) -> None:
    if isinstance(nilai, bool) or not isinstance(nilai, (int, float)):
        raise PengaturanSuaraTidakValid(f"{nama} harus angka, bukan {nilai!r}")
    if nilai < minimum or (maksimum is not None and nilai > maksimum):
        raise PengaturanSuaraTidakValid(f"{nama}={nilai} di luar rentang {minimum}..{maksimum}")


def periksa(d: dict) -> dict:
    """Melempar PengaturanSuaraTidakValid jika ada bagian/angka yang hilang atau tidak masuk akal."""
    try:
        for e in EKSPRESI:
            _angka(d["ekspresi"][e]["pitch"], f"ekspresi.{e}.pitch", 0, 2)
            _angka(d["ekspresi"][e]["rate"], f"ekspresi.{e}.rate", 0.1, 10)
        for p in PERSONA:
            _angka(d["persona"][p]["pitch"], f"persona.{p}.pitch", -1, 1)
            _angka(d["persona"][p]["rate"], f"persona.{p}.rate", 0.1, 10)
        for k in ("rate", "pitch"):
            b = d["batas"][k]
            _angka(b["min"], f"batas.{k}.min")
            _angka(b["maks"], f"batas.{k}.maks", b["min"])
        v = d["vad"]
        for p in PERSONA:
            _angka(v["diam_selesai_ms"][p], f"vad.diam_selesai_ms.{p}", 100, 10000)
        m = v["diam_manual_ms"]
        _angka(m["min"], "vad.diam_manual_ms.min", 100)
        _angka(m["maks"], "vad.diam_manual_ms.maks", m["min"])
        _angka(m["langkah"], "vad.diam_manual_ms.langkah", 1)
        for k in ("min_bicara_ms", "pad_awal_ms", "barge_in_ms"):
            _angka(v[k], f"vad.{k}", 0, 10000)
        for k in ("ambang_bicara", "ambang_barge_in", "selisih_ambang_diam", "ambang_diam_min"):
            _angka(v[k], f"vad.{k}", 0, 1)
        if v["laju_sampel_hz"] != 16000:
            raise PengaturanSuaraTidakValid("vad.laju_sampel_hz harus 16000 (ditentukan model Silero dan Whisper)")
        f = d["filler"]
        _angka(f["filler_ms"], "filler.filler_ms", 0, 10000)
        if f["ekspresi"] not in EKSPRESI or not all(f["kalimat"].get(p) for p in PERSONA):
            raise PengaturanSuaraTidakValid("filler.ekspresi tidak dikenal atau filler.kalimat kosong untuk persona")
        ms = d["mesin_suara"]
        for k in ("jeda_setelah_batal_ms", "batas_macet_ms", "periksa_ms"):
            _angka(ms[k], f"mesin_suara.{k}", 1, 60000)
        ps = d["perintah_suara"]
        for k in ("volume_awal", "volume_langkah", "volume_min", "volume_maks"):
            _angka(ps[k], f"perintah_suara.{k}", 0, 1)
        for k in ("kecepatan_awal", "kecepatan_langkah", "kecepatan_min"):
            _angka(ps[k], f"perintah_suara.{k}", 0, 10)
        _angka(d["rekaman"]["min_ukuran_byte"], "rekaman.min_ukuran_byte", 0)
    except (KeyError, TypeError) as e:
        raise PengaturanSuaraTidakValid(f"bagian hilang di config/suara.yaml: {e}") from None
    return d


def muat() -> dict:
    """Isi config/suara.yaml (sudah diperiksa) + kecepatan_persona dari thresholds.yaml (tts.kecepatan)."""
    with open(ROOT / "config" / "suara.yaml", encoding="utf-8") as f:
        data = periksa(yaml.safe_load(f) or {})
    data["kecepatan_persona"] = dict(get_thresholds()["tts"]["kecepatan"])
    return data
