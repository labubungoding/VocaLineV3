"""Bentuk data masuk dan keluar. Harus sama dengan kontrak data di Project Brief Vine."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

Persona = Literal["remaja", "dewasa", "lansia"]
JenisPengingat = Literal["makan_pagi", "makan_siang", "makan_malam", "kunjungan_dokter", "lainnya"]
PenyediaSTT = Literal["groq", "lokal"]
PenyediaLLM = Literal["groq", "gemini", "template"]
Ekspresi = Literal["senang", "antusias", "empati", "tenang", "bercanda", "serius", "netral"]


class _DataPasien(BaseModel):
    id_kasur: str = Field(..., examples=["B2-204-1"])
    umur: int | None = Field(None, ge=0, le=130, examples=[68])
    nama_panggilan: str = Field("", max_length=40, description="Diisi perawat, misalnya 'Pak Yusuf'. Bukan nama lengkap",
                                examples=["Pak Yusuf"])
    persona: Persona | None = Field(None, description="Dihitung backend dari tabel pengaturan")


class _PilihanPenyedia(BaseModel):
    """Override penyedia untuk pengujian. Hanya dihormati jika VINE_DEMO_PAGE aktif, selain itu diabaikan."""

    stt_provider: PenyediaSTT | None = Field(None, description="Hanya untuk uji di /demo: groq atau lokal")
    llm_provider: PenyediaLLM | None = Field(None, description="Hanya untuk uji di /demo: groq, gemini, atau template")


class PermintaanAudio(_DataPasien, _PilihanPenyedia):
    audio: str = Field(..., description="Base64 audio: WAV, atau WebM/Opus/Ogg/MP3 langsung dari MediaRecorder")
    jumlah_tanya_ulang: int = Field(0, ge=0)


class PermintaanTeks(_DataPasien, _PilihanPenyedia):
    teks: str = Field(..., examples=["dada saya sakit sekali"])
    jumlah_tanya_ulang: int = Field(0, ge=0)
    skor_keyakinan: float = Field(1.0, ge=0, le=1, description="Untuk mensimulasikan ucapan tidak jelas")


class PermintaanStream(_DataPasien, _PilihanPenyedia):
    """Untuk /converse-stream: isi `audio` ATAU `teks` (salah satu saja)."""

    audio: str | None = Field(None, description="Base64 audio, sama seperti /process-audio")
    teks: str | None = Field(None, examples=["dada saya sakit sekali"], description="Untuk uji tanpa suara")
    jumlah_tanya_ulang: int = Field(0, ge=0)
    skor_keyakinan: float = Field(1.0, ge=0, le=1, description="Hanya untuk `teks`: mensimulasikan ucapan tidak jelas")

    @model_validator(mode="after")
    def _audio_atau_teks(self) -> PermintaanStream:
        if (self.audio is None) == (self.teks is None):
            raise ValueError("Isi salah satu: `audio` atau `teks`")
        return self


class PermintaanSapaan(_DataPasien):
    """Dikirim backend saat perawat menekan Aktifkan tablet."""


class PermintaanPengingat(_DataPasien):
    """Dikirim backend (pg_cron) saat jam pengingat tiba."""

    jenis: JenisPengingat = "makan_siang"
    pesan_tambahan: str = Field("", max_length=200, description="Kalimat tambahan dari perawat, opsional")


class PermintaanReset(BaseModel):
    id_kasur: str


class WaktuTahap(BaseModel):
    stt_ms: int = 0
    nlu_ms: int = 0
    llm_pertama_ms: int = Field(0, description="Sampai kalimat pertama dari LLM. Di jalur JSON sama dengan llm_ms")
    llm_ms: int = 0
    total_ms: int = 0


class PenyediaDipakai(BaseModel):
    stt: str = Field("-", description="groq, lokal, atau - (tidak ada audio/STT)")
    llm: str = Field("-", description="groq:<model>, gemini:<model>, template, atau - (tanpa LLM)")


class Jawaban(BaseModel):
    teks_pasien: str
    skor_keyakinan: float
    maksud: str
    level_alarm: Literal["merah", "oranye", "hijau"]
    ringkasan_alarm: str
    emosi: Literal["ceria", "sedih", "marah", "netral"]
    visual_vine: Literal["kuning", "biru", "tenang", "ramah"]
    balasan_teks: str
    perlu_tanya_ulang: bool
    perintah: str | None = Field(None, description="vine_off, vine_on, volume_turun, volume_naik, bicara_pelan, ulangi, diam")
    sumber_balasan: str
    waktu_proses_ms: int
    kecepatan_bicara: float = Field(1.0, description="Untuk utterance.rate di Web Speech API")
    balasan_audio: str | None = Field(None, description="WAV base64 jika TTS di server aktif (piper/mms), selain itu null")
    ekspresi: Ekspresi = Field("netral", description="Ekspresi wajah Vine untuk balasan ini")
    waktu: WaktuTahap = Field(default_factory=lambda: WaktuTahap(), description="Lama tiap tahap dalam milidetik")
    penyedia: PenyediaDipakai = Field(default_factory=lambda: PenyediaDipakai(),
                                      description="Penyedia STT dan LLM yang benar-benar dipakai")


class JawabanUcapan(BaseModel):
    balasan_teks: str
    visual_vine: Literal["kuning", "biru", "tenang", "ramah"]
    kecepatan_bicara: float
    balasan_audio: str | None = None
