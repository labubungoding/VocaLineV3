"""Mengubah audio base64 dari Edge Function menjadi array float32 mono 16 kHz.

Format yang diterima:
- WAV (dibaca soundfile, atau modul wave bawaan Python jika soundfile tidak ada)
- WebM/Opus, Ogg, MP3, M4A dari MediaRecorder browser (dibaca lewat PyAV milik faster-whisper)
Jadi frontend boleh langsung mengirim hasil MediaRecorder tanpa konversi.
"""
from __future__ import annotations

import base64
import io
import wave

import numpy as np

from src.utils.logger import log_warning

SAMPLE_RATE = 16000


class AudioError(ValueError):
    pass


def decode_base64(audio_b64: str) -> bytes:
    if audio_b64.startswith("data:") and "," in audio_b64[:100]:
        audio_b64 = audio_b64.split(",", 1)[1]
    try:
        return base64.b64decode(audio_b64, validate=False)
    except Exception as e:
        raise AudioError("audio bukan base64 yang valid") from e


def _resample(audio: np.ndarray, sr: int) -> np.ndarray:
    if sr == SAMPLE_RATE:
        return audio.astype(np.float32)
    from math import gcd

    from scipy.signal import resample_poly

    g = gcd(sr, SAMPLE_RATE)
    return resample_poly(audio, SAMPLE_RATE // g, sr // g).astype(np.float32)


def _baca_soundfile(data: bytes) -> np.ndarray:
    import soundfile as sf

    wav, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    return _resample(wav.mean(axis=1), sr)


def _baca_wave(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data), "rb") as w:
        lebar, kanal, sr = w.getsampwidth(), w.getnchannels(), w.getframerate()
        mentah = w.readframes(w.getnframes())
    if lebar != 2:
        raise ValueError("hanya WAV PCM 16-bit")
    audio = np.frombuffer(mentah, dtype=np.int16).astype(np.float32) / 32768.0
    if kanal > 1:
        audio = audio.reshape(-1, kanal).mean(axis=1)
    return _resample(audio, sr)


def _baca_pyav(data: bytes) -> np.ndarray:
    """WebM/Opus, Ogg, MP3, M4A lewat PyAV (sudah terpasang bersama faster-whisper)."""
    import av

    try:
        wadah = av.open(io.BytesIO(data), mode="r", metadata_errors="ignore")
    except TypeError:
        wadah = av.open(io.BytesIO(data), mode="r")

    potongan = []
    with wadah:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        for frame in wadah.decode(audio=0):
            for f in resampler.resample(frame):
                potongan.append(f.to_ndarray().reshape(-1))
        try:
            for f in resampler.resample(None):
                potongan.append(f.to_ndarray().reshape(-1))
        except Exception:
            pass
    if not potongan:
        raise ValueError("tidak ada audio di dalam file")
    return (np.concatenate(potongan).astype(np.float32) / 32768.0)


def load_audio(data: bytes) -> np.ndarray:
    if len(data) < 100:
        raise AudioError(f"audio terlalu kecil ({len(data)} byte), kemungkinan rekaman kosong")
    galat = []
    for baca in (_baca_soundfile, _baca_wave, _baca_pyav):
        try:
            audio = baca(data)
            if audio.size:
                return audio
        except Exception as e:
            galat.append(f"{baca.__name__}: {type(e).__name__}: {str(e)[:120]}")
    log_warning("audio_tidak_terbaca", ukuran_byte=len(data), awal_file=data[:4].hex(), detail=galat)
    raise AudioError("format audio tidak dikenali. Kirim WAV, WebM/Opus, Ogg, atau MP3")


def durasi_detik(audio: np.ndarray) -> float:
    return len(audio) / SAMPLE_RATE
