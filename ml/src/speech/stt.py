"""Suara ke teks. Penyedia bisa ditukar lewat STT_PROVIDER di .env:

- "groq": Whisper large-v3-turbo di server Groq (cepat, butuh internet dan GROQ_API_KEY).
- "lokal": Whisper (faster-whisper) di CPU laptop. Juga menjadi cadangan otomatis jika Groq gagal,
  batas waktu terlewati, atau kuota habis.

Whisper tidak memberi satu "skor keyakinan" langsung. Skor dihitung dari avg_logprob
setiap segmen (dirata-rata menurut durasi), lalu diturunkan jika no_speech_prob tinggi.
Rumus yang sama dipakai untuk kedua penyedia.
"""
from __future__ import annotations

import importlib.util
import io
import math
import os
import re
import threading
import wave
from dataclasses import dataclass

import numpy as np

from src.speech.audio_utils import SAMPLE_RATE
from src.utils.http import klien_async, klien_sync, pemanasan_groq
from src.utils.kuota import GalatKuota, PembatasKuota, baca_retry_after, error_kuota
from src.utils.logger import log_event, log_warning

PENYEDIA_STT = ("groq", "lokal")


@dataclass
class HasilSTT:
    teks: str
    keyakinan: float
    no_speech: float
    penyedia: str = "lokal"


def skor_keyakinan(segmen: list[tuple[float, float, float]]) -> tuple[float, float]:
    """segmen = [(durasi, avg_logprob, no_speech_prob), ...] → (keyakinan, no_speech rata-rata)."""
    if not segmen:
        return 0.0, 1.0
    total = sum(max(d, 1e-3) for d, _, _ in segmen)
    logprob = sum(max(d, 1e-3) * lp for d, lp, _ in segmen) / total
    no_speech = sum(max(d, 1e-3) * ns for d, _, ns in segmen) / total
    keyakinan = math.exp(logprob) * (1 - no_speech)
    return max(0.0, min(1.0, keyakinan)), no_speech


def halusinasi(teks: str, pola: list[re.Pattern]) -> bool:
    """True jika transkrip cocok dengan kalimat yang sering dikarang Whisper saat hening atau bising."""
    t = teks.lower()
    return any(p.search(t) for p in pola)


def _hasil_akhir(teks: str, segmen: list[tuple[float, float, float]], pola: list[re.Pattern],
                 penyedia: str) -> HasilSTT:
    """Filter halusinasi lalu hitung skor keyakinan. Dipakai kedua penyedia."""
    teks = teks.strip()
    if teks and halusinasi(teks, pola):
        log_warning("whisper_halusinasi_dibuang", penyedia=penyedia)
        return HasilSTT(teks="", keyakinan=0.0, no_speech=1.0, penyedia=penyedia)
    keyakinan, no_speech = skor_keyakinan(segmen)
    return HasilSTT(teks=teks, keyakinan=keyakinan, no_speech=no_speech, penyedia=penyedia)


def ke_wav16k(audio: np.ndarray) -> bytes:
    """Array float32 mono 16 kHz → WAV PCM 16-bit, untuk dikirim ke Groq."""
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def jumlah_inti_fisik() -> int:
    """Perkiraan jumlah inti fisik: os.cpu_count() menghitung thread (hyper-threading), jadi dibagi dua."""
    return max(2, (os.cpu_count() or 4) // 2)


class SpeechToText:
    """Whisper lokal (faster-whisper) di CPU.

    Model dimuat secara LAZY: baru dimuat saat pertama kali dibutuhkan (STT_PROVIDER=lokal,
    cadangan saat Groq gagal, atau pemanasan), supaya tidak memakan RAM saat memakai Groq.
    """

    nama = "lokal"

    def __init__(self, ukuran_model: str = "small", prompt_awal: str = "", pola_halusinasi: list[str] | None = None,
                 cpu_threads: int | None = None):
        self._model = None
        self._gagal = False
        self._lock = threading.Lock()
        self.ukuran = ukuran_model
        self.cpu_threads = cpu_threads or jumlah_inti_fisik()
        self.prompt_awal = prompt_awal or None
        self.pola_halusinasi = [re.compile(p) for p in (pola_halusinasi or [])]
        self._terpasang = importlib.util.find_spec("faster_whisper") is not None
        if not self._terpasang:
            log_warning("whisper_tidak_aktif", error="faster-whisper belum terpasang")

    @property
    def aktif(self) -> bool:
        """Bisa dipakai (sudah dimuat, atau terpasang dan belum pernah gagal dimuat)."""
        return self._model is not None or (self._terpasang and not self._gagal)

    @property
    def dimuat(self) -> bool:
        return self._model is not None

    def muat(self) -> bool:
        if self._model is not None:
            return True
        if not self.aktif:
            return False
        with self._lock:
            if self._model is None:
                try:
                    import time

                    from faster_whisper import WhisperModel

                    mulai = time.perf_counter()
                    self._model = WhisperModel(self.ukuran, device="cpu", compute_type="int8",
                                               cpu_threads=self.cpu_threads)
                    log_event("whisper_lokal_dimuat", ukuran=self.ukuran, cpu_threads=self.cpu_threads,
                              ms=int((time.perf_counter() - mulai) * 1000))
                except Exception as e:
                    self._gagal = True
                    log_warning("whisper_tidak_aktif", error=str(e)[:200])
        return self._model is not None

    def pemanasan(self) -> None:
        """Satu inferensi dummy (1 detik hening) supaya permintaan pertama pasien tidak lambat."""
        if self.muat():
            segments, _ = self._model.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language="id",
                                                 beam_size=1, without_timestamps=True)
            list(segments)

    def transcribe(self, audio: np.ndarray) -> HasilSTT:
        if not self.muat():
            raise RuntimeError("Whisper lokal tidak aktif. Jalankan: pip install faster-whisper")
        segments, _ = self._model.transcribe(
            audio, language="id", beam_size=1, vad_filter=False, condition_on_previous_text=False,
            initial_prompt=self.prompt_awal, without_timestamps=True,
        )
        segments = list(segments)
        teks = " ".join(s.text.strip() for s in segments)
        return _hasil_akhir(teks, [(s.end - s.start, s.avg_logprob, s.no_speech_prob) for s in segments],
                            self.pola_halusinasi, self.nama)


class GroqSTT:
    """Whisper di Groq lewat endpoint transkripsi yang kompatibel dengan OpenAI.

    Parameter sesuai console.groq.com/docs/speech-to-text: file, model, language, prompt (maks 224 token),
    response_format=verbose_json (berisi segments dengan avg_logprob dan no_speech_prob), temperature.
    """

    nama = "groq"
    URL = "https://api.groq.com/openai/v1/audio/transcriptions"

    def __init__(self, api_key: str, model: str = "whisper-large-v3-turbo", prompt_awal: str = "",
                 pola_halusinasi: list[str] | None = None, maks_per_menit: int = 20, maks_per_hari: int | None = 2000,
                 jeda_detik: float = 60, batas_waktu_detik: float = 10, klien=None, klien_async=None,
                 keepalive_detik: float = 120):
        self.model = model
        self.prompt_awal = prompt_awal
        self.pola_halusinasi = [re.compile(p) for p in (pola_halusinasi or [])]
        self.pembatas = PembatasKuota(maks_per_menit, jeda_detik, maks_per_hari=maks_per_hari)
        self.batas_waktu = batas_waktu_detik
        self.keepalive = keepalive_detik
        self._klien = klien or klien_sync(batas_waktu_detik, keepalive_detik)
        self._klien_async = klien_async
        self._kunci = api_key

    def status(self) -> dict:
        return self.pembatas.status()

    def _permintaan(self, audio: np.ndarray) -> dict:
        if not self.pembatas.ambil_izin():
            raise GalatKuota("pembatas kuota Groq Whisper menolak")
        data = {"model": self.model, "language": "id", "response_format": "verbose_json", "temperature": "0"}
        if self.prompt_awal:
            data["prompt"] = self.prompt_awal
        return {"url": self.URL, "data": data, "files": {"file": ("ucapan.wav", ke_wav16k(audio), "audio/wav")},
                "headers": {"Authorization": f"Bearer {self._kunci}"}}

    def transcribe(self, audio: np.ndarray) -> HasilSTT:
        """Melempar exception jika gagal; pengalih (PengenalSuara) yang memindahkan ke Whisper lokal."""
        return self._baca_jawaban(self._klien.post(**self._permintaan(audio)))

    async def transcribe_async(self, audio: np.ndarray) -> HasilSTT:
        return self._baca_jawaban(await self._async().post(**self._permintaan(audio)))

    def _async(self):
        if self._klien_async is None:
            self._klien_async = klien_async(self.batas_waktu, self.keepalive)
        return self._klien_async

    async def pemanasan(self) -> dict:
        """Membuka koneksi ke Groq (GET /models, tanpa kuota transkripsi)."""
        return await pemanasan_groq(self._klien, self._async(), self._kunci)

    def _baca_jawaban(self, r) -> HasilSTT:
        if r.status_code == 429:
            jeda = baca_retry_after(r.headers.get("retry-after"))
            self.pembatas.kuota_habis(jeda)
            raise GalatKuota("429 dari Groq Whisper", jeda)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        isi = r.json()
        segmen = [(float(s.get("end", 0)) - float(s.get("start", 0)), float(s.get("avg_logprob", -5.0)),
                   float(s.get("no_speech_prob", 1.0))) for s in (isi.get("segments") or [])]
        return _hasil_akhir(isi.get("text", ""), segmen, self.pola_halusinasi, self.nama)


class PengenalSuara:
    """Memilih penyedia STT dan memindahkan ke Whisper lokal jika Groq gagal."""

    def __init__(self, penyedia: str, lokal: SpeechToText, groq: GroqSTT | None = None):
        self.penyedia = penyedia if penyedia in PENYEDIA_STT else "groq"
        self.lokal = lokal
        self.groq = groq
        if self.penyedia == "groq" and groq is None:
            log_warning("groq_stt_tidak_aktif", alasan="GROQ_API_KEY kosong, memakai Whisper lokal")

    @property
    def aktif(self) -> bool:
        return self.groq is not None or self.lokal.aktif

    @property
    def ukuran(self) -> str:
        return self.lokal.ukuran

    def pemanasan(self) -> None:
        if self.penyedia == "lokal":
            self.lokal.pemanasan()

    def status(self) -> dict:
        return {
            "stt_provider": self.penyedia,
            "groq_stt": self.groq.model if self.groq else "tidak_aktif",
            "whisper_lokal": self.lokal.ukuran if self.lokal.aktif else "tidak_aktif",
            "whisper_lokal_dimuat": self.lokal.dimuat,
        }

    def transcribe(self, audio: np.ndarray, penyedia: str | None = None) -> HasilSTT:
        """`penyedia` mengganti pilihan .env untuk satu permintaan (hanya dari halaman /demo)."""
        pilihan = penyedia if penyedia in PENYEDIA_STT else self.penyedia
        if pilihan == "groq" and self.groq is not None:
            try:
                return self.groq.transcribe(audio)
            except Exception as e:
                alasan = "kuota" if error_kuota(e) else type(e).__name__
                log_warning("groq_stt_gagal_pakai_lokal", alasan=alasan, detail=str(e)[:200])
        return self.lokal.transcribe(audio)

    async def transcribe_async(self, audio: np.ndarray, penyedia: str | None = None, antrean=None) -> HasilSTT:
        """Versi async. Groq dipanggil dengan klien async; Whisper lokal (berat di CPU) dijalankan di thread.

        `antrean` = semaphore (threading) yang membatasi Whisper lokal berjalan bersamaan.
        """
        import anyio

        pilihan = penyedia if penyedia in PENYEDIA_STT else self.penyedia
        if pilihan == "groq" and self.groq is not None:
            try:
                return await self.groq.transcribe_async(audio)
            except Exception as e:
                alasan = "kuota" if error_kuota(e) else type(e).__name__
                log_warning("groq_stt_gagal_pakai_lokal", alasan=alasan, detail=str(e)[:200])

        def lokal() -> HasilSTT:
            if antrean is None:
                return self.lokal.transcribe(audio)
            with antrean:
                return self.lokal.transcribe(audio)

        return await anyio.to_thread.run_sync(lokal)
