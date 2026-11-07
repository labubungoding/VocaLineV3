"""Alat uji untuk tim, aktif hanya jika MODE_DEV=true di .env.

- GET  /coba                 : halaman uji suara (bicara ke Vine lewat mikrofon laptop/HP)
- POST /dev/simpan-rekaman   : menyimpan ucapan sebagai rekaman uji Whisper di data/stt_test/
                               dan menambahkan barisnya ke transkrip.csv

Jangan aktifkan saat demo lewat Cloudflare Tunnel.
"""
from __future__ import annotations

import csv
import re
import threading
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from config.settings import ROOT
from src.api.security import cek_kunci
from src.speech.audio_utils import AudioError, decode_base64, load_audio

router = APIRouter()
FOLDER_UJI = ROOT / "data" / "stt_test"
HALAMAN = Path(__file__).parent / "static" / "coba.html"
_lock = threading.Lock()

EKSTENSI = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
            "audio/x-wav": "wav"}


class PermintaanSimpan(BaseModel):
    audio: str = Field(..., description="Data URL base64 dari MediaRecorder, misalnya data:audio/webm;base64,...")
    teks: str = Field(..., min_length=1, max_length=300, description="Kalimat yang BENAR-BENAR diucapkan")
    kelompok: Literal["remaja", "dewasa", "lansia", "buruk"]
    jenis: str = Field("normal", max_length=60)


@router.get("/coba", response_class=HTMLResponse, include_in_schema=False)
def halaman_coba() -> str:
    return HALAMAN.read_text(encoding="utf-8")


@router.post("/dev/simpan-rekaman", dependencies=[Depends(cek_kunci)])
def simpan_rekaman(req: PermintaanSimpan) -> dict:
    cocok = re.match(r"data:([\w/+-]+)[;,]", req.audio)
    tipe = cocok.group(1).split(";")[0] if cocok else "audio/webm"
    ekstensi = EKSTENSI.get(tipe, "webm")
    try:
        data = decode_base64(req.audio)
        load_audio(data)
    except AudioError as e:
        raise HTTPException(422, str(e)) from e

    with _lock:
        FOLDER_UJI.mkdir(parents=True, exist_ok=True)
        nomor = 1 + sum(1 for f in FOLDER_UJI.glob(f"{req.kelompok}_rekam*"))
        nama = f"{req.kelompok}_rekam{nomor:02d}.{ekstensi}"
        (FOLDER_UJI / nama).write_bytes(data)
        transkrip = FOLDER_UJI / "transkrip.csv"
        baru = not transkrip.exists()
        with open(transkrip, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if baru:
                w.writerow(["file", "teks", "jenis"])
            w.writerow([nama, req.teks.strip(), req.jenis])
    return {"file": nama, "jumlah_rekaman": nomor}
