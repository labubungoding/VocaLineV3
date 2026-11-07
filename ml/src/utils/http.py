"""Klien HTTP bersama untuk Groq, dan pemanasan koneksi saat startup.

Koneksi TLS pertama ke server luar butuh beberapa ratus milidetik. Dengan membuka koneksi saat startup
(panggilan kecil yang tidak memakai kuota generasi) dan menahannya tetap hidup (keepalive), permintaan
pertama pasien tidak ikut menanggung waktu itu.
"""
from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

import httpx

URL_MODEL_GROQ = "https://api.groq.com/openai/v1/models"
KEEPALIVE_DETIK = 120.0


def _batas(keepalive: float) -> httpx.Limits:
    return httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=keepalive)


def klien_sync(batas_waktu: float, keepalive: float = KEEPALIVE_DETIK) -> httpx.Client:
    return httpx.Client(timeout=batas_waktu, limits=_batas(keepalive))


def klien_async(batas_waktu: float, keepalive: float = KEEPALIVE_DETIK) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=batas_waktu, limits=_batas(keepalive))


async def ukur(panggil: Callable[[], Awaitable[object]]) -> dict:
    """Menjalankan satu panggilan pemanasan. Galat dicatat, tidak pernah dilempar."""
    mulai = time.perf_counter()
    try:
        hasil = await panggil()
        ok = not (isinstance(hasil, httpx.Response) and hasil.status_code >= 400)
        galat = None if ok else f"HTTP {hasil.status_code}"
    except Exception as e:
        ok, galat = False, type(e).__name__
    return {"ok": ok, "ms": int((time.perf_counter() - mulai) * 1000), **({"galat": galat} if galat else {})}


async def pemanasan_groq(sync: httpx.Client, asinkron: httpx.AsyncClient, kunci: str) -> dict:
    """GET /models (tanpa kuota generasi) lewat klien async dan klien sync."""
    import anyio

    header = {"Authorization": f"Bearer {kunci}"}
    return {
        "async": await ukur(lambda: asinkron.get(URL_MODEL_GROQ, headers=header)),
        "sync": await ukur(lambda: anyio.to_thread.run_sync(lambda: sync.get(URL_MODEL_GROQ, headers=header))),
    }
