"""Server FastAPI ml-service.

Jalankan dari folder ml-service:
    uvicorn src.api.main:app --host 0.0.0.0 --port 8000

Set VINE_TANPA_SUARA=1 untuk menyalakan server tanpa memuat Whisper dan VAD
(berguna untuk menguji /process-text dengan cepat).
"""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.concurrency import run_in_threadpool

from config.settings import get_settings, get_thresholds
from src.api.routes import router
from src.pipeline import VinePipeline
from src.utils.logger import log_event


@asynccontextmanager
async def lifespan(app: FastAPI):
    mulai = time.perf_counter()
    muat_suara = os.environ.get("VINE_TANPA_SUARA") != "1"
    app.state.pipeline = VinePipeline(muat_suara=muat_suara)
    pemanasan_ms = app.state.pipeline.pemanasan()
    koneksi = get_thresholds().get("koneksi", {})
    if koneksi.get("pemanasan_saat_startup", True):
        await app.state.pipeline.pemanasan_koneksi(koneksi.get("batas_waktu_pemanasan_detik", 8))
    pemanasan_thread_ms = await run_in_threadpool(app.state.pipeline.pemanasan)
    log_event("server_siap", lama_startup_ms=int((time.perf_counter() - mulai) * 1000),
              pemanasan_ms=pemanasan_ms, pemanasan_thread_ms=pemanasan_thread_ms, **app.state.pipeline.status())
    yield


app = FastAPI(title="Vine ml-service", version="0.1.0", lifespan=lifespan)
app.include_router(router)

if get_settings().mode_dev:
    from src.api.dev import router as router_dev

    app.include_router(router_dev)
