"""Pemeriksaan kunci rahasia X-API-Key.

Alamat Cloudflare Tunnel bisa diakses siapa saja, jadi setiap permintaan wajib membawa kunci
yang sama dengan ML_API_KEY di .env. Hanya Edge Function yang menyimpan kunci ini.
"""
from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from config.settings import get_settings


async def cek_kunci(x_api_key: str | None = Header(default=None)) -> None:
    kunci = get_settings().ml_api_key
    if not kunci:
        raise HTTPException(503, "ML_API_KEY belum diisi di .env. Server menolak semua permintaan demi keamanan.")
    if not x_api_key or not secrets.compare_digest(x_api_key, kunci):
        raise HTTPException(401, "Header X-API-Key salah atau tidak ada")
