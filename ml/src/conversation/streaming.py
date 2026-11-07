"""Alat bantu balasan streaming (/converse-stream).

Untuk jalur streaming, LLM tidak menjawab dalam JSON (JSON tidak bisa diucapkan sebelum selesai).
Formatnya (lihat src/conversation/prompt_builder.py):

    [[level=hijau;ekspresi=senang;alasan=-;ingat=suka bola]]
    Kalimat balasan biasa. Kalimat berikutnya.

- PenguraiHeader membaca header level dari awal stream, tahan header hilang atau terpotong.
- PemecahKalimat memotong teks yang datang sepotong-sepotong menjadi kalimat utuh,
  supaya kalimat pertama bisa langsung diucapkan.
"""
from __future__ import annotations

import json
import re

LEVEL_VALID = ("merah", "oranye", "hijau")
_POLA_TUTUP = re.compile(r"^\s*\[\[([^\]\n]*)\]\]\s*")
_MAKS_PANJANG_HEADER = 200


def urai_isi_header(isi: str, lengkap: bool = True) -> dict:
    """'level=merah;ekspresi=serius;alasan=nyeri dada' → dict. Nilai level yang tidak valid dibuang.

    Jika header tidak lengkap (terpotong), hanya level dan ekspresi yang dipercaya.
    """
    data: dict[str, str] = {}
    for bagian in isi.split(";"):
        if "=" in bagian:
            k, v = bagian.split("=", 1)
        elif ":" in bagian:
            k, v = bagian.split(":", 1)
        else:
            continue
        k, v = k.strip().lower(), v.strip().strip("\"'").strip()
        if k and v and v != "-":
            data[k] = v
    if data.get("level", "").lower() in LEVEL_VALID:
        data["level"] = data["level"].lower()
    else:
        data.pop("level", None)
    if not lengkap:
        data = {k: v for k, v in data.items() if k in ("level", "ekspresi")}
    return data


class PenguraiHeader:
    """Memisahkan header `[[level=...;ekspresi=...;alasan=...;ingat=...]]` dari teks balasan.

    Pakai `tambah(potongan)` untuk setiap potongan stream; hasilnya teks balasan yang sudah aman diteruskan.
    Selama header belum lengkap, teks ditahan. Setelah stream selesai, panggil `selesai()`.
    `level` berisi None jika header hilang, rusak, atau terpotong (pemanggil memakai level lokal).
    `data` berisi semua field header yang terbaca (ekspresi, alasan, ingat).
    """

    def __init__(self):
        self.data: dict[str, str] = {}
        self._tahan = ""
        self._beres = False
        self._buang_spasi = False

    @property
    def level(self) -> str | None:
        return self.data.get("level")

    def _putuskan(self, akhir: bool) -> str | None:
        teks = self._tahan
        awal = teks.lstrip()
        if not awal:
            return "" if akhir else None
        if not awal.startswith("[[") and (len(awal) >= 2 or not awal.startswith("[")):
            self._beres = True
            return teks
        if awal == "[" and not akhir:
            return None
        tutup = _POLA_TUTUP.match(teks)
        if tutup:
            self.data = urai_isi_header(tutup.group(1))
            self._beres = True
            return teks[tutup.end():]
        isi = awal[2:]
        if "\n" in teks or len(teks) > _MAKS_PANJANG_HEADER or akhir:
            baris = teks.split("\n", 1)
            self.data = urai_isi_header(isi.split("\n", 1)[0].rstrip("]"), lengkap=False)
            self._beres = True
            return baris[1].lstrip() if len(baris) > 1 else ""
        return None

    def tambah(self, potongan: str) -> str:
        if self._beres:
            if self._buang_spasi:
                potongan = potongan.lstrip()
                self._buang_spasi = not potongan
            return potongan
        self._tahan += potongan
        hasil = self._putuskan(akhir=False)
        if hasil is not None:
            hasil = hasil.lstrip() if self.data or self._tahan.lstrip().startswith("[[") else hasil
            self._buang_spasi = not hasil
        return hasil or ""

    def selesai(self) -> str:
        if self._beres:
            return ""
        return (self._putuskan(akhir=True) or "").lstrip()


def urai_header(teks: str) -> tuple[str | None, str]:
    """Versi sekali jalan untuk teks lengkap: (level atau None, balasan)."""
    p = PenguraiHeader()
    balasan = p.tambah(teks) + p.selesai()
    return p.level, balasan


def urai_header_lengkap(teks: str) -> tuple[dict, str]:
    """Seperti urai_header, tetapi mengembalikan semua field header."""
    p = PenguraiHeader()
    balasan = p.tambah(teks) + p.selesai()
    return p.data, balasan


_POLA_AKHIR_KALIMAT = re.compile(r"[.!?…]+[\"')\]]*\s+")


class PemecahKalimat:
    """Memotong teks stream menjadi kalimat.

    - Kalimat dianggap selesai saat bertemu . ! ? (atau …) yang diikuti spasi/baris baru.
    - Kalimat yang terlalu pendek (< min_kata) digabung dengan kalimat berikutnya,
      supaya Vine tidak mengucapkan potongan seperti "Oh." lalu jeda.
    - `selesai()` mengeluarkan sisa teks di akhir stream.
    """

    def __init__(self, min_kata: int = 3):
        self.min_kata = min_kata
        self._buf = ""
        self._pendek = ""

    def _keluarkan(self, kalimat: str) -> list[str]:
        kalimat = " ".join(kalimat.split())
        if not kalimat:
            return []
        if self._pendek:
            kalimat = f"{self._pendek} {kalimat}"
            self._pendek = ""
        if len(kalimat.split()) < self.min_kata:
            self._pendek = kalimat
            return []
        return [kalimat]

    def tambah(self, potongan: str) -> list[str]:
        self._buf += potongan
        hasil = []
        while True:
            m = _POLA_AKHIR_KALIMAT.search(self._buf)
            if not m:
                break
            hasil += self._keluarkan(self._buf[: m.end()])
            self._buf = self._buf[m.end():]
        return hasil

    def selesai(self) -> list[str]:
        sisa = " ".join(f"{self._pendek} {self._buf}".split())
        self._buf = self._pendek = ""
        return [sisa] if sisa else []


def pecah_kalimat(teks: str, min_kata: int = 3) -> list[str]:
    p = PemecahKalimat(min_kata)
    return p.tambah(teks) + p.selesai()


def format_sse(event: str, data: dict) -> str:
    """Satu event Server-Sent Events."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
