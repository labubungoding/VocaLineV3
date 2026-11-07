"""Persona Vine per kelompok umur dan nama panggilan pasien.

Rentang usia diatur superadmin (tim IT rumah sakit) di tabel `pengaturan` di Supabase.
Backend menghitung persona dari umur pasien lalu mengirimnya ke ml-service.
Fungsi persona_dari_umur di bawah hanya cadangan untuk testing, memakai rentang default.

Nama panggilan diisi perawat saat mengaktifkan tablet, lengkap dengan sapaannya,
misalnya "Pak Yusuf", "Bu Rina", atau "Dimas". Vine memanggil persis seperti itu.
"""
from __future__ import annotations

import re
from functools import lru_cache

from config.settings import ROOT

PERSONA_VALID = ("remaja", "dewasa", "lansia")

RENTANG_DEFAULT = {"remaja": (13, 17), "dewasa": (18, 59), "lansia": (60, 200)}

PENANDA = "{panggilan}"


def persona_dari_umur(umur: int, rentang: dict[str, tuple[int, int]] | None = None) -> str | None:
    rentang = rentang or RENTANG_DEFAULT
    for persona, (bawah, atas) in rentang.items():
        if bawah <= umur <= atas:
            return persona
    return None


def pastikan_persona(persona: str | None, umur: int | None) -> str:
    if persona in PERSONA_VALID:
        return persona
    if umur is not None:
        hasil = persona_dari_umur(umur)
        if hasil:
            return hasil
    return "dewasa"


def bersihkan_panggilan(nama: str | None) -> str:
    """Merapikan nama panggilan dari perawat. Maksimal 30 karakter, tanpa simbol aneh."""
    if not nama:
        return ""
    nama = re.sub(r"[^\w\s.'-]", "", nama).strip()
    return " ".join(nama.split())[:30]


def isi_panggilan(teks: str, nama: str | None) -> str:
    """Mengganti {panggilan} dengan nama panggilan pasien.

    Jika nama kosong, penanda dihapus beserta koma di sekitarnya supaya kalimat tetap wajar:
    "Kangen cucu ya, {panggilan}." -> "Kangen cucu ya."
    """
    if PENANDA not in teks:
        return teks
    nama = bersihkan_panggilan(nama)
    if nama:
        hasil = teks.replace(PENANDA, nama)
        return re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), hasil)
    hasil = re.sub(r",\s*\{panggilan\}", "", teks)
    hasil = re.sub(r"\{panggilan\}\s*,?\s*", "", hasil)
    hasil = re.sub(r"\s+([.!?,])", r"\1", hasil)
    hasil = re.sub(r"\s{2,}", " ", hasil).strip()
    return re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), hasil)


@lru_cache
def baca_prompt(nama: str) -> str:
    return (ROOT / "prompts" / f"{nama}.md").read_text(encoding="utf-8").strip()


def prompt_persona(persona: str) -> str:
    return baca_prompt(f"persona_{persona}")
