"""Endpoint ml-service."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, StreamingResponse

from src.api.schemas import (
    Jawaban,
    JawabanUcapan,
    PermintaanAudio,
    PermintaanPengingat,
    PermintaanReset,
    PermintaanSapaan,
    PermintaanStream,
    PermintaanTeks,
)
from src.api.security import cek_kunci
from src.conversation.streaming import format_sse
from src.pipeline import VinePipeline
from src.speech.audio_utils import AudioError

router = APIRouter()


def pipeline(request: Request) -> VinePipeline:
    return request.app.state.pipeline


def pilihan_penyedia(req) -> tuple[str | None, str | None]:
    """Override stt_provider/llm_provider hanya dihormati saat halaman uji aktif (VINE_DEMO_PAGE=1).

    Saat demo dimatikan (server dibuka ke publik), permintaan selalu memakai penyedia dari .env.
    """
    from config.settings import get_settings

    if not get_settings().vine_demo_page:
        return None, None
    return req.stt_provider, req.llm_provider


@router.get("/demo", response_class=HTMLResponse, include_in_schema=False)
def demo() -> HTMLResponse:
    """Halaman uji suara untuk tim ML. Matikan saat demo publik dengan VINE_DEMO_PAGE=0 di .env."""
    from config.settings import get_settings

    if not get_settings().vine_demo_page:
        raise HTTPException(404, "Halaman uji dimatikan")
    return HTMLResponse((Path(__file__).parent / "demo.html").read_text(encoding="utf-8"))


@router.get("/pengaturan-suara", dependencies=[Depends(cek_kunci)])
def pengaturan_suara() -> dict:
    """Semua angka suara dan VAD untuk frontend (config/suara.yaml + kecepatan_persona). Dimuat frontend saat start.

    Berisi nada/kecepatan per ekspresi dan persona, batas rate/pitch, VAD (diam_selesai_ms per persona,
    min_bicara_ms, barge_in_ms, ...), filler (filler_ms, kalimat), mesin suara, perintah suara, dan rekaman.
    Dibaca ulang setiap permintaan. 500 jika config/suara.yaml rusak (frontend tetap memakai pengaturan terakhir).
    """
    from src.speech.pengaturan_suara import PengaturanSuaraTidakValid, muat

    try:
        return muat()
    except PengaturanSuaraTidakValid as e:
        raise HTTPException(500, f"config/suara.yaml tidak valid: {e}") from None


@router.get("/health")
def health(p: VinePipeline = Depends(pipeline)) -> dict:
    return {"status": "ok", "komponen": p.status()}


@router.post("/process-audio", response_model=Jawaban, dependencies=[Depends(cek_kunci)])
def process_audio(req: PermintaanAudio, p: VinePipeline = Depends(pipeline)) -> dict:
    try:
        stt, llm = pilihan_penyedia(req)
        hasil = p.process_audio(req.id_kasur, req.audio, req.umur, req.persona, req.jumlah_tanya_ulang,
                                req.nama_panggilan, stt_provider=stt, llm_provider=llm)
    except AudioError as e:
        raise HTTPException(422, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e
    return hasil.to_dict()


@router.post("/process-text", response_model=Jawaban, dependencies=[Depends(cek_kunci)])
def process_text(req: PermintaanTeks, p: VinePipeline = Depends(pipeline)) -> dict:
    _, llm = pilihan_penyedia(req)
    hasil = p.process_text(req.id_kasur, req.teks, req.skor_keyakinan, req.umur, req.persona,
                           req.jumlah_tanya_ulang, req.nama_panggilan, llm_provider=llm)
    return hasil.to_dict()


@router.post("/converse-stream", dependencies=[Depends(cek_kunci)],
             responses={200: {"content": {"text/event-stream": {}},
                              "description": "Server-Sent Events: analisis → kalimat (berulang) → selesai, atau galat"}})
async def converse_stream(req: PermintaanStream, p: VinePipeline = Depends(pipeline)) -> StreamingResponse:
    """Alarm dulu, lalu balasan per kalimat. Lihat docs/integrasi.md untuk format event."""
    stt, llm = pilihan_penyedia(req)
    audio = None
    if req.audio is not None:
        try:
            audio = await run_in_threadpool(p.siapkan_audio, req.audio)
        except AudioError as e:
            raise HTTPException(422, str(e)) from e
        except RuntimeError as e:
            raise HTTPException(503, str(e)) from e

    async def aliran():
        async for nama, data in p.converse_stream(
                req.id_kasur, teks=req.teks, audio=audio, keyakinan=req.skor_keyakinan, umur=req.umur,
                persona=req.persona, jumlah_tanya_ulang=req.jumlah_tanya_ulang, nama_panggilan=req.nama_panggilan,
                stt_provider=stt, llm_provider=llm):
            yield format_sse(nama, data)

    return StreamingResponse(aliran(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/greeting", response_model=JawabanUcapan, dependencies=[Depends(cek_kunci)])
def greeting(req: PermintaanSapaan, p: VinePipeline = Depends(pipeline)) -> dict:
    return p.greeting(req.id_kasur, req.persona, req.umur, req.nama_panggilan).to_dict()


@router.post("/reminder", response_model=JawabanUcapan, dependencies=[Depends(cek_kunci)])
def reminder(req: PermintaanPengingat, p: VinePipeline = Depends(pipeline)) -> dict:
    return p.reminder(req.id_kasur, req.jenis, req.persona, req.umur, req.nama_panggilan,
                      req.pesan_tambahan).to_dict()


@router.post("/reset-session", dependencies=[Depends(cek_kunci)])
def reset_session(req: PermintaanReset, p: VinePipeline = Depends(pipeline)) -> dict:
    return {"id_kasur": req.id_kasur, "dihapus": p.reset(req.id_kasur)}
