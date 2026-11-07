"""Deteksi apakah ada ucapan di dalam rekaman (Silero VAD), dan memotong hening di awal/akhir.

Jika paket silero-vad tidak tersedia, memakai pengecekan energi sederhana (tanpa pemotongan).
"""
from __future__ import annotations

import numpy as np

from src.speech.audio_utils import SAMPLE_RATE
from src.utils.logger import log_warning


class VoiceDetector:
    def __init__(self, sisa_hening_ms: int = 200):
        self._model = None
        self.sisa = int(SAMPLE_RATE * sisa_hening_ms / 1000)
        try:
            from silero_vad import load_silero_vad

            self._model = load_silero_vad()
        except Exception as e:
            log_warning("vad_pakai_energi", error=str(e)[:120])

    @property
    def aktif(self) -> bool:
        return self._model is not None

    def rentang_ucapan(self, audio: np.ndarray) -> tuple[int, int] | None:
        """(awal, akhir) dalam sampel, dari ucapan pertama sampai terakhir. None jika tidak ada ucapan."""
        if len(audio) < SAMPLE_RATE * 0.2:
            return None
        if self._model is None:
            return (0, len(audio)) if float(np.sqrt(np.mean(audio**2))) > 0.01 else None
        import torch
        from silero_vad import get_speech_timestamps

        stamps = get_speech_timestamps(torch.from_numpy(audio), self._model, sampling_rate=SAMPLE_RATE)
        if not stamps:
            return None
        return stamps[0]["start"], stamps[-1]["end"]

    def ada_ucapan(self, audio: np.ndarray) -> bool:
        return self.rentang_ucapan(audio) is not None

    def potong_hening(self, audio: np.ndarray) -> np.ndarray | None:
        """Membuang hening di awal dan akhir rekaman supaya Whisper memproses lebih sedikit audio.

        Mengembalikan None jika tidak ada ucapan.
        """
        rentang = self.rentang_ucapan(audio)
        if rentang is None:
            return None
        awal, akhir = rentang
        return audio[max(0, awal - self.sisa): min(len(audio), akhir + self.sisa)]
