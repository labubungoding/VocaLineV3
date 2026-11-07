"""Suara Vine (teks ke suara).

Kokoro belum mendukung bahasa Indonesia, jadi tersedia tiga pilihan lewat TTS_PROVIDER di .env:

- "browser" (default): ml-service hanya mengirim teks, tablet mengucapkannya dengan Web Speech API.
  Paling ringan, tapi suaranya beda-beda per perangkat.
- "piper": Piper TTS dengan suara id_ID-news_tts-medium. Ringan dan cepat di CPU, suara konsisten
  di semua tablet. ml-service mengirim audio WAV base64 di field balasan_audio.
- "mms": MMS-TTS bahasa Indonesia dari Meta (facebook/mms-tts-ind) lewat transformers.
  Tidak perlu file tambahan, tapi lebih lambat dan suaranya lebih kaku. Lisensi non-komersial.

Kecepatan bicara menyesuaikan persona (lansia lebih pelan), diatur di thresholds.yaml bagian tts.
"""
from __future__ import annotations

import base64
import io
import wave
from pathlib import Path

import numpy as np

from src.utils.logger import log_warning


def _wav_base64(audio: np.ndarray, sample_rate: int) -> str:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


class BrowserTTS:
    nama = "browser"

    def synthesize(self, teks: str, kecepatan: float = 1.0) -> str | None:
        return None


class PiperTTS:
    nama = "piper"

    def __init__(self, model_path: Path):
        from piper import PiperVoice

        if not model_path.exists():
            raise FileNotFoundError(f"File suara Piper tidak ditemukan: {model_path}")
        self.voice = PiperVoice.load(str(model_path))

    def synthesize(self, teks: str, kecepatan: float = 1.0) -> str | None:
        buf = io.BytesIO()
        length_scale = 1.0 / max(kecepatan, 0.5)
        with wave.open(buf, "wb") as wav_file:
            try:
                from piper import SynthesisConfig

                self.voice.synthesize_wav(teks, wav_file, syn_config=SynthesisConfig(length_scale=length_scale))
            except ImportError:
                self.voice.synthesize(teks, wav_file, length_scale=length_scale)
        return base64.b64encode(buf.getvalue()).decode("ascii")


class MMSTTS:
    nama = "mms"

    def __init__(self, model_name: str = "facebook/mms-tts-ind"):
        import torch
        from transformers import AutoTokenizer, VitsModel

        self._torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = VitsModel.from_pretrained(model_name)
        self.model.eval()

    def synthesize(self, teks: str, kecepatan: float = 1.0) -> str | None:
        self.model.speaking_rate = kecepatan
        inputs = self.tokenizer(teks, return_tensors="pt")
        with self._torch.no_grad():
            audio = self.model(**inputs).waveform[0].cpu().numpy()
        return _wav_base64(audio, self.model.config.sampling_rate)


def buat_tts(provider: str, piper_model_path: Path) -> BrowserTTS | PiperTTS | MMSTTS:
    try:
        if provider == "piper":
            return PiperTTS(piper_model_path)
        if provider == "mms":
            return MMSTTS()
    except Exception as e:
        log_warning("tts_kembali_ke_browser", provider=provider, error=str(e)[:200])
    return BrowserTTS()
