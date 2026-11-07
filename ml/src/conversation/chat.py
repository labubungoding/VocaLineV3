"""Menyusun balasan Vine.

Penyedia model bahasa bisa ditukar lewat LLM_PROVIDER di .env:
- "groq": model terbuka di Groq (endpoint kompatibel OpenAI). Cadangan: gemini, lalu template.
- "gemini": Gemini tier gratis lewat google-genai. Cadangan: template.
- "template": balasan template tanpa internet. Selalu tersedia sebagai cadangan terakhir.

Riwayat obrolan hanya disimpan di memori (lihat src/session.py), tidak pernah ditulis ke file.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass, field

from src.conversation.fewshot import format_contoh, pilih_contoh
from src.conversation.persona import baca_prompt, bersihkan_panggilan, isi_panggilan, prompt_persona
from src.conversation.sapaan import balasan_cadangan
from src.intent.llm_check import JawabanLLM, parse_jawaban
from src.utils.kuota import GalatKuota, PembatasKuota, baca_retry_after
from src.utils.kuota import error_kuota as _error_kuota
from src.utils.http import klien_async, klien_sync, pemanasan_groq, ukur
from src.utils.logger import log_error, log_event, log_warning

__all__ = ["ChatEngine", "GeminiProvider", "GroqProvider", "KonteksBalasan", "PembatasKuota", "TemplateProvider",
           "_error_kuota", "susun_instruksi", "susun_percakapan"]

class GalatWaktuHabis(TimeoutError):
    """Token pertama atau seluruh jawaban melewati batas waktu (gemini.batas_waktu_* di thresholds.yaml)."""


GALAT_SEMENTARA = ("timeout", "503", "504")


def jenis_galat(e: BaseException) -> str:
    """Golongan galat untuk log dan keputusan coba ulang: timeout / 429 / 503 / 504 / galat. Tanpa isi teks."""
    import httpx

    if isinstance(e, (TimeoutError, asyncio.TimeoutError, httpx.TimeoutException)):
        return "timeout"
    if _error_kuota(e):
        return "429"
    kode = getattr(e, "code", None) or getattr(e, "status_code", None)
    if kode in (503, 504):
        return str(kode)
    teks = str(e).upper()
    if "504" in teks or "DEADLINE_EXCEEDED" in teks:
        return "504"
    if "503" in teks or "UNAVAILABLE" in teks:
        return "503"
    return "galat"


class GalatModel(RuntimeError):
    """Satu model gagal menjawab dengan format yang benar (mis. Groq "tool_use_failed": model penalaran
    kadang memanggil alat walau tidak diminta). Model berikutnya di penyedia yang sama boleh dicoba."""


def _galat_groq(pesan: str) -> RuntimeError:
    pesan = pesan.split("failed_generation", 1)[0].rstrip(" ,'\"{")
    return (GalatModel if "tool_use_failed" in pesan else RuntimeError)(pesan)


CADANGAN = {"groq": ("gemini",), "gemini": (), "template": ()}
PENYEDIA_VALID = ("groq", "gemini", "template")


@dataclass
class KonteksBalasan:
    teks_pasien: str
    persona: str
    emosi: str
    maksud: str
    level_lokal: str
    nama_panggilan: str = ""
    riwayat: list[tuple[str, str]] = field(default_factory=list)
    jumlah_contoh: int = 0
    alarm_terucap: str = ""
    fakta: list[str] = field(default_factory=list)
    pembuka_terakhir: list[str] = field(default_factory=list)
    template_terakhir: dict = field(default_factory=dict)
    topik: dict | None = None


def susun_instruksi(k: KonteksBalasan, stream: bool = False) -> str:
    """System prompt ringkas dari src/conversation/prompt_builder.py (gaya di config/gaya_bicara.yaml).

    `stream=True`: format header [[level=...;ekspresi=...]] + teks biasa, bukan JSON.
    """
    from src.conversation import prompt_builder

    return prompt_builder.susun(k, stream)


def susun_percakapan(k: KonteksBalasan) -> str:
    """Pesan pengguna: topik, fakta, giliran topik aktif, lalu ucapan terakhir (src/conversation/prompt_builder.py)."""
    from src.conversation import prompt_builder

    return prompt_builder.susun_pesan(k)


class TemplateProvider:
    """Balasan tanpa model bahasa, mengikuti persona dan nama panggilan. Selalu tersedia."""

    nama = "template"

    EKSPRESI = {"alarm_lanjutan": "tenang", "medis": "tenang", "ceria": "senang", "sedih": "empati",
                "marah": "tenang", "netral": "netral", "belum_ingat": "netral"}

    def balas(self, k: KonteksBalasan) -> JawabanLLM:
        if k.level_lokal in ("merah", "oranye") or k.alarm_terucap:
            kunci = "alarm_lanjutan"
        elif k.maksud == "pertanyaan_medis":
            kunci = "medis"
        elif not (k.riwayat or k.fakta) and "ingat" in k.teks_pasien.lower():
            kunci = "belum_ingat"
        else:
            kunci = k.emosi
        teks = balasan_cadangan(kunci, k.persona, k.nama_panggilan, k.template_terakhir)
        return JawabanLLM(teks, None, "", ekspresi=self.EKSPRESI.get(kunci, "netral"))


class _PenyediaBanyakModel:
    """Dasar penyedia yang punya beberapa model (dipisah koma di .env).

    Model berikutnya dipakai saat kuota model sebelumnya habis. Setiap model punya kuota sendiri.
    Subkelas cukup mengisi `nama`, `models`, `pembatas`, dan `_panggil(model, k) -> str`.
    """

    nama = "llm"
    models: list[str]
    pembatas: dict[str, PembatasKuota]
    maks_ulang_sementara = 0

    def _panggil(self, model: str, k: KonteksBalasan) -> str:
        raise NotImplementedError

    def _info_percobaan(self, model: str) -> dict:
        """Angka tambahan untuk log percobaan (mis. token berpikir). Tanpa isi teks."""
        return {}

    def _log_percobaan(self, model: str, hasil: str, mulai: float, pertama: float | None = None) -> None:
        """Satu baris log per panggilan model: model, hasil, lama (ms). Tidak pernah berisi teks."""
        data = {"model": model, "hasil": hasil, "ms": int((time.perf_counter() - mulai) * 1000)}
        if pertama is not None:
            data["ms_pertama"] = int((pertama - mulai) * 1000)
        log_event(f"{self.nama}_percobaan", **data, **self._info_percobaan(model))

    def status(self) -> dict:
        return {m: p.status() for m, p in self.pembatas.items()}

    def balas(self, k: KonteksBalasan) -> JawabanLLM | None:
        ulang = 0
        for model in self.models:
            pembatas = self.pembatas[model]
            if not pembatas.ambil_izin():
                continue
            mulai = time.perf_counter()
            try:
                teks = self._panggil(model, k)
            except Exception as e:
                jenis = jenis_galat(e)
                self._log_percobaan(model, jenis, mulai)
                if _error_kuota(e):
                    pembatas.kuota_habis(getattr(e, "jeda_detik", None))
                    log_warning(f"{self.nama}_kuota_habis", model=model, istirahat_detik=pembatas.jeda)
                    continue
                if isinstance(e, GalatModel):
                    log_warning(f"{self.nama}_model_gagal", model=model, detail=str(e)[:120])
                    continue
                log_error(f"{self.nama}_gagal", model=model, error=type(e).__name__, detail=str(e)[:200])
                if jenis in GALAT_SEMENTARA and ulang < self.maks_ulang_sementara:
                    ulang += 1
                    continue
                return None
            self._log_percobaan(model, "ok", mulai)
            hasil = parse_jawaban(teks)
            if hasil is None:
                log_warning(f"{self.nama}_format_rusak", model=model)
                return None
            hasil.balasan = isi_panggilan(hasil.balasan, k.nama_panggilan)
            hasil.model = model
            return hasil
        log_event(f"{self.nama}_dibatasi", alasan="semua model kena batas per menit, per hari, atau masa istirahat")
        return None

    def _stream(self, model: str, k: KonteksBalasan) -> AsyncIterator[str]:
        raise NotImplementedError

    async def balas_stream(self, k: KonteksBalasan) -> AsyncIterator[tuple[str, str]]:
        """Menghasilkan (model, potongan teks) dalam format header + teks biasa.

        Model berikutnya hanya dicoba jika kuota habis SEBELUM ada potongan yang keluar.
        Galat lain dilempar ke pemanggil (ChatEngine), yang memindahkan ke penyedia cadangan.
        """
        ulang = 0
        for model in self.models:
            pembatas = self.pembatas[model]
            if not pembatas.ambil_izin():
                continue
            sudah_keluar = False
            mulai, pertama, hasil = time.perf_counter(), None, "ok"
            try:
                async with aclosing(self._stream(model, k)) as aliran:
                    async for potongan in aliran:
                        if potongan:
                            if not sudah_keluar:
                                pertama = time.perf_counter()
                            sudah_keluar = True
                            yield model, potongan
                if sudah_keluar:
                    return
                hasil = "kosong"
                log_warning(f"{self.nama}_model_kosong", model=model)
                continue
            except Exception as e:
                hasil = jenis_galat(e)
                if _error_kuota(e) and not sudah_keluar:
                    pembatas.kuota_habis(getattr(e, "jeda_detik", None))
                    log_warning(f"{self.nama}_kuota_habis", model=model, istirahat_detik=pembatas.jeda)
                    continue
                if isinstance(e, GalatModel) and not sudah_keluar:
                    log_warning(f"{self.nama}_model_gagal", model=model, detail=str(e)[:120])
                    continue
                if hasil in GALAT_SEMENTARA and not sudah_keluar and ulang < self.maks_ulang_sementara:
                    ulang += 1
                    log_error(f"{self.nama}_gagal", model=model, error=type(e).__name__, detail=str(e)[:200])
                    continue
                raise
            finally:
                self._log_percobaan(model, hasil, mulai, pertama)
        log_event(f"{self.nama}_dibatasi", alasan="semua model kena batas per menit, per hari, atau masa istirahat")


class GeminiProvider(_PenyediaBanyakModel):
    """Memanggil Gemini lewat google-genai.

    - Thinking dimatikan (thinking_budget=0) jika model mendukung. Model yang menolak (400 INVALID_ARGUMENT,
      mis. gemini-3.5-flash-lite) turun ke thinking_level=minimal, lalu ke bawaan model. Langkah ini diingat
      per model, jadi panggilan yang ditolak hanya terjadi sekali per model sejak server menyala.
    - Batas waktu token pertama dan total dari thresholds.yaml (gemini.batas_waktu_*).
    - Timeout/503/504: model cadangan dicoba sekali (`maks_ulang_sementara`), lalu template.
    - SDK tidak mencoba ulang sendiri (retry_options attempts=1), supaya urutan percobaan di atas yang berlaku.
    """

    nama = "gemini"
    maks_ulang_sementara = 1
    batas_total = 15.0
    batas_pertama = 15.0
    matikan_thinking = True
    maks_token_berpikir = 1024

    def __init__(self, api_key: str, model: str, maks_per_menit: int = 10, jeda_detik: float = 60,
                 batas_waktu_detik: float = 15, maks_per_hari: int | None = None,
                 batas_token_pertama_detik: float | None = None, ulang_ke_cadangan: int = 1,
                 matikan_thinking: bool = True, maks_token_berpikir: int = 1024):
        from google import genai
        from google.genai import types

        self.batas_total = float(batas_waktu_detik)
        self.batas_pertama = float(batas_token_pertama_detik or batas_waktu_detik)
        self.maks_ulang_sementara = int(ulang_ke_cadangan)
        self.matikan_thinking = matikan_thinking
        self.maks_token_berpikir = maks_token_berpikir
        self._batas_http = max(10.0, self.batas_total)
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(
            timeout=int((self._batas_http + 2) * 1000), retry_options=types.HttpRetryOptions(attempts=1)))
        self.models = [m.strip() for m in model.split(",") if m.strip()]
        self.pembatas = {m: PembatasKuota(maks_per_menit, jeda_detik, maks_per_hari=maks_per_hari) for m in self.models}
        self._thinking: dict[str, str] = {}
        self._token_berpikir: dict[str, int] = {}

    URUTAN_THINKING = ("mati", "minimal", "bawaan")

    def mode_thinking(self, model: str) -> str:
        if not self.matikan_thinking:
            return "bawaan"
        return getattr(self, "_thinking", {}).get(model, "mati")

    def _config(self, model: str, k: KonteksBalasan, stream: bool):
        from google.genai import types

        from src.conversation.prompt_builder import maks_token

        cfg = {"system_instruction": susun_instruksi(k, stream=stream), "temperature": 0.7,
               "max_output_tokens": maks_token(k)}
        if not stream:
            cfg["response_mime_type"] = "application/json"
            cfg["http_options"] = types.HttpOptions(timeout=int(self._batas_http * 1000),
                                                    retry_options=types.HttpRetryOptions(attempts=1))
        mode = self.mode_thinking(model)
        if mode == "mati":
            cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        else:
            if mode == "minimal":
                cfg["thinking_config"] = types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)
            cfg["max_output_tokens"] = max(cfg["max_output_tokens"], self.maks_token_berpikir)
        return types.GenerateContentConfig(**cfg)

    def _thinking_ditolak(self, model: str, e: Exception) -> bool:
        """True jika API menolak pengaturan thinking (400). Pesan galatnya umum ("invalid argument"), jadi setiap
        400 saat pengaturan thinking dikirim dianggap penolakan: model turun satu langkah lalu dipanggil ulang.
        Jika tetap 400 tanpa pengaturan thinking, galat itu diteruskan."""
        mode = self.mode_thinking(model)
        if mode == "bawaan" or getattr(e, "code", None) != 400:
            return False
        baru = self.URUTAN_THINKING[self.URUTAN_THINKING.index(mode) + 1]
        self._thinking[model] = baru
        log_warning("gemini_thinking_ditolak", model=model, dari=mode, ke=baru)
        return True

    def _catat_token(self, model: str, resp) -> None:
        jumlah = getattr(getattr(resp, "usage_metadata", None), "thoughts_token_count", None)
        if jumlah is not None:
            self._token_berpikir[model] = jumlah

    def _info_percobaan(self, model: str) -> dict:
        token = getattr(self, "_token_berpikir", {})
        info = {"thinking": self.mode_thinking(model)}
        if model in token:
            info["token_berpikir"] = token.pop(model)
        return info

    def _panggil(self, model: str, k: KonteksBalasan) -> str:
        for _ in self.URUTAN_THINKING:
            try:
                resp = self.client.models.generate_content(model=model, contents=susun_percakapan(k),
                                                           config=self._config(model, k, stream=False))
            except Exception as e:
                if self._thinking_ditolak(model, e):
                    continue
                raise
            self._catat_token(model, resp)
            return resp.text or ""
        return ""

    async def pemanasan(self) -> dict:
        """Membuka koneksi ke Gemini dengan membaca info model (tidak memakai kuota generasi)."""
        import anyio

        model = self.models[0]
        return {
            "async": await ukur(lambda: self.client.aio.models.get(model=model)),
            "sync": await ukur(lambda: anyio.to_thread.run_sync(lambda: self.client.models.get(model=model))),
        }

    async def _stream(self, model: str, k: KonteksBalasan) -> AsyncIterator[str]:
        """Potongan teks dari Gemini. GalatWaktuHabis jika token pertama atau seluruh jawaban melewati batas."""
        mulai = time.perf_counter()

        def sisa(pertama: bool) -> float:
            lewat = time.perf_counter() - mulai
            batas = self.batas_total - lewat
            return min(batas, self.batas_pertama - lewat) if pertama else batas

        async def tunggu(aw, pertama: bool):
            batas = sisa(pertama)
            if batas <= 0:
                raise GalatWaktuHabis("token pertama" if pertama else "total")
            try:
                return await asyncio.wait_for(aw, batas)
            except TimeoutError:
                raise GalatWaktuHabis("token pertama" if pertama else "total") from None

        for _ in self.URUTAN_THINKING:
            aliran, pertama = None, True
            try:
                aliran = await tunggu(self.client.aio.models.generate_content_stream(
                    model=model, contents=susun_percakapan(k), config=self._config(model, k, stream=True)), True)
                it = aliran.__aiter__()
                while True:
                    try:
                        bagian = await tunggu(it.__anext__(), pertama)
                    except StopAsyncIteration:
                        return
                    self._catat_token(model, bagian)
                    teks = bagian.text or ""
                    if teks:
                        pertama = False
                        yield teks
            except Exception as e:
                if pertama and self._thinking_ditolak(model, e):
                    continue
                raise
            finally:
                if aliran is not None and hasattr(aliran, "aclose"):
                    try:
                        await aliran.aclose()
                    except Exception:
                        pass


class GroqProvider(_PenyediaBanyakModel):
    """Memanggil model di Groq lewat endpoint chat completions yang kompatibel dengan OpenAI.

    Format jawaban sama dengan Gemini (prompts/classifier.md), dipaksa JSON dengan response_format.
    Untuk model penalaran, penalaran dibuat seminimal mungkin dan teksnya disembunyikan
    (lihat console.groq.com/docs/reasoning):
    - openai/gpt-oss-*: reasoning_effort="low" (nilai terendah), include_reasoning=false
    - qwen/*: reasoning_effort="none", reasoning_format="hidden"
    Kedua parameter penyembunyi tidak boleh dipakai bersamaan.
    """

    nama = "groq"
    URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str, model: str, maks_per_menit: int = 30, jeda_detik: float = 60,
                 batas_waktu_detik: float = 8, maks_per_hari: int | None = 1000, maks_token: int = 1024,
                 suhu: float = 0.7, klien=None, klien_async=None, keepalive_detik: float = 120):
        self.models = [m.strip() for m in model.split(",") if m.strip()]
        self.pembatas = {m: PembatasKuota(maks_per_menit, jeda_detik, maks_per_hari=maks_per_hari) for m in self.models}
        self.maks_token = maks_token
        self.suhu = suhu
        self.batas_waktu = batas_waktu_detik
        self.keepalive = keepalive_detik
        self._klien = klien or klien_sync(batas_waktu_detik, keepalive_detik)
        self._klien_async = klien_async
        self._kunci = api_key

    def _async(self):
        if self._klien_async is None:
            self._klien_async = klien_async(self.batas_waktu, self.keepalive)
        return self._klien_async

    async def pemanasan(self) -> dict:
        """Membuka koneksi ke Groq (GET /models, tanpa kuota generasi) untuk klien async dan sync."""
        return await pemanasan_groq(self._klien, self._async(), self._kunci)

    @staticmethod
    def opsi_penalaran(model: str) -> dict:
        m = model.lower()
        if m.startswith("openai/gpt-oss"):
            return {"reasoning_effort": "low", "include_reasoning": False}
        if m.startswith("qwen/"):
            return {"reasoning_effort": "none", "reasoning_format": "hidden"}
        return {}

    def isi_permintaan(self, model: str, k: KonteksBalasan) -> dict:
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": susun_instruksi(k)},
                {"role": "user", "content": susun_percakapan(k)},
            ],
            "response_format": {"type": "json_object"},
            "temperature": self.suhu,
            "max_completion_tokens": self.maks_token,
            **self.opsi_penalaran(model),
        }

    def _panggil(self, model: str, k: KonteksBalasan) -> str:
        r = self._klien.post(self.URL, json=self.isi_permintaan(model, k),
                             headers={"Authorization": f"Bearer {self._kunci}"})
        if r.status_code == 429:
            raise GalatKuota("429 dari Groq", baca_retry_after(r.headers.get("retry-after")))
        if r.status_code >= 400:
            raise _galat_groq(f"HTTP {r.status_code}: {r.text[:200]}")
        pilihan = r.json().get("choices") or [{}]
        return (pilihan[0].get("message") or {}).get("content") or ""

    def isi_permintaan_stream(self, model: str, k: KonteksBalasan) -> dict:
        """Streaming: teks biasa dengan header level (tanpa response_format JSON)."""
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": susun_instruksi(k, stream=True)},
                {"role": "user", "content": susun_percakapan(k)},
            ],
            "stream": True,
            "temperature": self.suhu,
            "max_completion_tokens": self.maks_token,
            **self.opsi_penalaran(model),
        }

    async def _stream(self, model: str, k: KonteksBalasan) -> AsyncIterator[str]:
        async with self._async().stream("POST", self.URL, json=self.isi_permintaan_stream(model, k),
                                            headers={"Authorization": f"Bearer {self._kunci}"}) as r:
            if r.status_code == 429:
                await r.aread()
                raise GalatKuota("429 dari Groq", baca_retry_after(r.headers.get("retry-after")))
            if r.status_code >= 400:
                await r.aread()
                raise _galat_groq(f"HTTP {r.status_code}: {r.text[:200]}")
            async for baris in r.aiter_lines():
                if not baris.startswith("data:"):
                    continue
                isi = baris[5:].strip()
                if isi == "[DONE]":
                    break
                try:
                    data = json.loads(isi)
                except json.JSONDecodeError:
                    continue
                if data.get("error"):
                    raise _galat_groq(f"galat stream Groq: {str(data['error'])[:200]}")
                pilihan = data.get("choices") or [{}]
                potongan = (pilihan[0].get("delta") or {}).get("content")
                if potongan:
                    yield potongan


class ChatEngine:
    """Memilih penyedia balasan dan menjalankan rantai cadangan: groq → gemini → template."""

    def __init__(self, provider_name: str, api_key: str, model: str, cfg_gemini: dict | None = None, *,
                 groq_api_key: str = "", groq_model: str = "", cfg_groq: dict | None = None,
                 batas_waktu_total_detik: float = 12, keepalive_detik: float = 120):
        self.template = TemplateProvider()
        self.penyedia: dict[str, object] = {"template": self.template}
        self.batas_waktu_total = batas_waktu_total_detik
        cfg_gemini = cfg_gemini or {}
        cfg_groq = cfg_groq or {}

        if api_key:
            try:
                self.penyedia["gemini"] = GeminiProvider(
                    api_key, model,
                    maks_per_menit=cfg_gemini.get("maks_per_menit", 10),
                    jeda_detik=cfg_gemini.get("jeda_setelah_kuota_habis_detik", 60),
                    batas_waktu_detik=cfg_gemini.get("batas_waktu_total_detik", cfg_gemini.get("batas_waktu_detik", 15)),
                    maks_per_hari=cfg_gemini.get("maks_per_hari"),
                    batas_token_pertama_detik=cfg_gemini.get("batas_waktu_token_pertama_detik", 15),
                    ulang_ke_cadangan=cfg_gemini.get("ulang_ke_model_cadangan", 1),
                    matikan_thinking=cfg_gemini.get("matikan_thinking", True),
                    maks_token_berpikir=cfg_gemini.get("maks_token_jika_berpikir", 1024),
                )
            except Exception as e:
                log_warning("gemini_tidak_aktif", error=str(e)[:200])
        elif provider_name in ("gemini", "groq"):
            log_warning("gemini_tidak_aktif", alasan="GEMINI_API_KEY kosong")

        if groq_api_key and groq_model:
            try:
                self.penyedia["groq"] = GroqProvider(
                    groq_api_key, groq_model,
                    maks_per_menit=cfg_groq.get("maks_per_menit", 30),
                    jeda_detik=cfg_groq.get("jeda_setelah_kuota_habis_detik", 60),
                    batas_waktu_detik=cfg_groq.get("batas_waktu_detik", 8),
                    maks_per_hari=cfg_groq.get("maks_per_hari", 1000),
                    maks_token=cfg_groq.get("maks_token", 1024),
                    suhu=cfg_groq.get("suhu", 0.7),
                    keepalive_detik=keepalive_detik,
                )
            except Exception as e:
                log_warning("groq_llm_tidak_aktif", error=str(e)[:200])
        elif provider_name == "groq":
            log_warning("groq_llm_tidak_aktif", alasan="GROQ_API_KEY kosong, memakai cadangan")

        self.diminta = provider_name if provider_name in PENYEDIA_VALID else "template"
        self.utama = self._rantai(self.diminta)[0]

    def _rantai(self, nama: str) -> list:
        """Daftar penyedia yang dicoba berurutan, berakhir dengan template."""
        urutan = [nama, *CADANGAN.get(nama, ())]
        rantai = [self.penyedia[n] for n in urutan if n in self.penyedia and n != "template"]
        return [*rantai, self.template]

    @property
    def nama(self) -> str:
        return self.utama.nama

    def status(self) -> dict | str:
        return self.utama.status() if hasattr(self.utama, "status") else self.utama.nama

    def status_kuota(self) -> dict:
        return {n: p.status() for n, p in self.penyedia.items() if hasattr(p, "status")}

    async def pemanasan_koneksi(self) -> dict:
        """Membuka koneksi ke semua penyedia LLM yang aktif. Galat dicatat, tidak dilempar."""
        import asyncio

        aktif = [(n, p) for n, p in self.penyedia.items() if hasattr(p, "pemanasan")]
        hasil = await asyncio.gather(*(p.pemanasan() for _, p in aktif), return_exceptions=True)
        return {n: (h if isinstance(h, dict) else {"ok": False, "galat": type(h).__name__})
                for (n, _), h in zip(aktif, hasil)}

    def model_aktif(self, nama: str) -> list[str]:
        p = self.penyedia.get(nama)
        return list(getattr(p, "models", []))

    def balas(self, k: KonteksBalasan, penyedia: str | None = None) -> tuple[JawabanLLM, str]:
        """Mengembalikan (jawaban, nama penyedia yang dipakai). Selalu ada jawaban.

        `penyedia` mengganti pilihan .env untuk satu permintaan (hanya dari halaman /demo).
        Model yang dipakai tersimpan di jawaban.model.
        """
        if penyedia in PENYEDIA_VALID:
            rantai = self._rantai(penyedia)
        else:
            rantai = [self.utama, *[p for p in self._rantai(self.utama.nama) if p is not self.utama]]
        mulai = time.perf_counter()
        for p in rantai:
            if p is self.template:
                break
            if time.perf_counter() - mulai > self.batas_waktu_total:
                log_warning("llm_waktu_habis", dilewati=p.nama, batas_detik=self.batas_waktu_total)
                break
            hasil = p.balas(k)
            if hasil is not None:
                return hasil, p.nama
        return self.template.balas(k), self.template.nama

    async def balas_stream(self, k: KonteksBalasan, penyedia: str | None = None
                           ) -> AsyncIterator[tuple[str, str, str]]:
        """Menghasilkan (nama penyedia, model, potongan teks) dari penyedia pertama yang berhasil.

        Penyedia cadangan hanya dicoba jika penyedia sebelumnya gagal SEBELUM mengeluarkan teks.
        Jika semua gagal, tidak ada yang dihasilkan, dan pemanggil memakai template.
        Template tidak di-stream di sini (pemanggil memanggil self.template.balas).
        """
        if penyedia in PENYEDIA_VALID:
            rantai = self._rantai(penyedia)
        else:
            rantai = [self.utama, *[p for p in self._rantai(self.utama.nama) if p is not self.utama]]
        mulai = time.perf_counter()
        for p in rantai:
            if p is self.template or not hasattr(p, "balas_stream"):
                continue
            if time.perf_counter() - mulai > self.batas_waktu_total:
                log_warning("llm_waktu_habis", dilewati=p.nama, batas_detik=self.batas_waktu_total)
                return
            sudah_keluar = False
            try:
                async with aclosing(p.balas_stream(k)) as aliran:
                    async for model, potongan in aliran:
                        sudah_keluar = True
                        yield p.nama, model, potongan
            except Exception as e:
                log_error(f"{p.nama}_stream_gagal", error=type(e).__name__, detail=str(e)[:200],
                          sudah_ada_teks=sudah_keluar)
                if sudah_keluar:
                    return
                continue
            if sudah_keluar:
                return
            log_warning(f"{p.nama}_stream_kosong", alasan="selesai tanpa teks, pindah ke cadangan")
