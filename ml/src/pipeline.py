"""Pengatur seluruh alur Vine, terjemahan langsung dari Alur B di flowchart.

Urutan saat pasien bicara:
1. Audio → VAD → Whisper → teks + skor keyakinan
2. Keyakinan rendah → alarm dulu jika ada tanda darurat, selain itu tanya ulang (maks 2x) lalu alarm oranye
3. Keyakinan cukup → aturan kata darurat + IndoBERT alarm (lokal) dan IndoBERT emosi + perataan
4. Perintah perangkat → dijawab langsung tanpa Gemini
5. Gemini menyusun balasan dan memberi level cadangan (hanya boleh menaikkan)
6. Guardrails memblokir saran medis
7. Suara Vine (jika TTS di server aktif)

Tambahan: sapaan pertama saat tablet diaktifkan dan pengingat jadwal dari perawat.
"""
from __future__ import annotations

import threading
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import asdict, dataclass, field

import numpy as np

from config.settings import Settings, get_settings, get_thresholds
from src.conversation import commands
from src.conversation.chat import ChatEngine, KonteksBalasan
from src.conversation.pasca_proses import PenyaringKalimat, ekspresi_valid, pembuka, sapaan_hormat
from src.conversation.persona import bersihkan_panggilan, pastikan_persona
from src.conversation.prompt_builder import aturan_alarm, muat_gaya, panjang
from src.conversation.sapaan import balasan_cadangan, pengingat, sapaan_pertama
from src.conversation.streaming import PemecahKalimat, PenguraiHeader, pecah_kalimat
from src.conversation.topik import PelacakTopik, PenyematTopik
from src.emotion.emotion_classifier import EmotionClassifier
from src.emotion.prosodi import PembacaNada, ciri_suara
from src.emotion.visual_mapper import visual_untuk
from src.intent.decide_level import (URUTAN, PenurunLevel, level_dari_maksud, level_dengan_alasan, level_lokal,
                                     tertinggi)
from src.intent.indobert_classifier import IntentClassifier
from src.intent.konteks_alarm import NAMA_KELUHAN, KeputusanAlarm, PemeriksaKonteks
from src.intent.konteks_alarm import catat as catat_konteks
from src.intent.ringkasan import ringkasan_lokal
from src.intent.safety_rules import SafetyRules, normalisasi
from src.session import SessionStore
from src.speech.audio_utils import SAMPLE_RATE, decode_base64, durasi_detik, load_audio
from src.speech.tts import BrowserTTS, buat_tts
from src.utils.logger import log_error, log_event, log_warning


@dataclass
class HasilPipeline:
    teks_pasien: str
    skor_keyakinan: float
    maksud: str
    level_alarm: str
    ringkasan_alarm: str
    emosi: str
    visual_vine: str
    balasan_teks: str
    perlu_tanya_ulang: bool
    perintah: str | None = None
    sumber_balasan: str = "template"
    waktu_proses_ms: int = 0
    kecepatan_bicara: float = 1.0
    balasan_audio: str | None = None
    ekspresi: str = "netral"
    waktu: dict = field(default_factory=lambda: {"stt_ms": 0, "nlu_ms": 0, "llm_pertama_ms": 0, "llm_ms": 0,
                                                 "total_ms": 0})
    penyedia: dict = field(default_factory=lambda: {"stt": "-", "llm": "-"})

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Analisis:
    """Hasil langkah yang tidak butuh LLM. `konteks` None berarti balasan sudah final (tanpa LLM)."""

    hasil: HasilPipeline
    persona: str
    nama_panggilan: str
    level_lokal: str
    konteks: KonteksBalasan | None = None
    alarm: str = ""
    hasil_id: str = ""
    tercatat: set = field(default_factory=set)
    konteks_alarm: KeputusanAlarm | None = None


def _ms(mulai: float) -> int:
    return int((time.perf_counter() - mulai) * 1000)


@dataclass
class HasilUcapan:
    """Untuk sapaan pertama dan pengingat: hanya kalimat Vine, tanpa analisis ucapan pasien."""

    balasan_teks: str
    visual_vine: str
    kecepatan_bicara: float
    balasan_audio: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class VinePipeline:
    def __init__(self, settings: Settings | None = None, muat_suara: bool = True):
        self.settings = s = settings or get_settings()
        cfg = get_thresholds()
        self.min_keyakinan = cfg["stt"]["min_keyakinan"]
        self.max_no_speech = cfg["stt"]["max_no_speech"]
        self.maks_tanya_ulang = cfg["tanya_ulang"]["maksimal"]
        self.jumlah_contoh = cfg["percakapan"]["jumlah_contoh"]
        self.kecepatan = cfg["tts"]["kecepatan"]
        self.maks_detik_audio = cfg.get("audio", {}).get("maks_detik", 30)
        self.min_kata_kalimat = cfg.get("streaming", {}).get("min_kata_kalimat", 3)
        self.riwayat_maks_kata = cfg["percakapan"].get("riwayat_maks_kata", 20)
        naik = cfg.get("kenaikan_level", {})
        self.gejala_di_ucapan = naik.get("gejala_harus_di_ucapan", True)
        self.maksud_terkunci = tuple(naik.get("maksud_terkunci", ["pertanyaan_medis", "ngobrol"]))
        self.pola_gejala = naik.get("pola_gejala", r"\b(sakit|nyeri|sesak|dada|jatuh|darah|pingsan|kejang)\b")
        self.ekspresi_bawaan = muat_gaya().get("ekspresi_bawaan", {})
        koneksi = cfg.get("koneksi", {})
        self.keepalive = koneksi.get("keepalive_detik", 120)
        self.hasil_pemanasan_koneksi: dict = {}
        self._antrean = threading.BoundedSemaphore(cfg.get("server", {}).get("maks_proses_bersamaan", 2))

        self.rules = SafetyRules()
        self.penurun = PenurunLevel(cfg.get("penurun_level"))
        self.konteks_alarm = PemeriksaKonteks(cfg.get("konteks_alarm"))
        self.intent = IntentClassifier(s.path(s.intent_model_dir), s.path(s.baseline_intent_path),
                                       cfg["intent"]["ambang_darurat"])
        self.emotion = EmotionClassifier(s.path(s.emotion_model_dir), s.path(s.baseline_emotion_path),
                                         cfg["emosi"].get("kata_kunci"))
        self.nada = PembacaNada(cfg["emosi"].get("suara"))
        ambang = cfg["emosi"]["ambang"]
        ambang = ambang.get(self.emotion.jenis, 0.6) if isinstance(ambang, dict) else ambang
        self.chat = ChatEngine(s.llm_provider, s.gemini_api_key, s.gemini_model, cfg.get("gemini"),
                               groq_api_key=s.groq_api_key, groq_model=s.groq_model, cfg_groq=cfg.get("groq_llm"),
                               batas_waktu_total_detik=cfg.get("llm", {}).get("batas_waktu_total_detik", 12),
                               keepalive_detik=self.keepalive)
        self.penyemat_topik, buat_topik = self._siapkan_topik(cfg.get("topik", {}))
        self.sessions = SessionStore(ambang, cfg["emosi"]["jendela_perataan"], cfg["percakapan"]["riwayat_maksimal"],
                                     cfg["percakapan"].get("sesi_kedaluwarsa_jam", 12) * 3600,
                                     fakta_maksimal=cfg["percakapan"].get("fakta_maksimal", 5),
                                     buat_topik=buat_topik,
                                     ambang_emosi_langsung=cfg["emosi"].get("ambang_langsung"))

        self.vad = None
        self.stt = None
        self.tts = BrowserTTS()
        if muat_suara:
            from src.speech.stt import GroqSTT, PengenalSuara, SpeechToText
            from src.speech.vad import VoiceDetector

            self.vad = VoiceDetector(cfg["stt"].get("sisa_hening_ms", 200))
            prompt, pola = cfg["stt"].get("prompt_awal", ""), cfg["stt"].get("halusinasi", [])
            lokal = SpeechToText(s.whisper_model, prompt, pola)
            groq = None
            if s.groq_api_key:
                g = cfg.get("groq_stt", {})
                groq = GroqSTT(s.groq_api_key, g.get("model", "whisper-large-v3-turbo"), prompt, pola,
                               maks_per_menit=g.get("maks_per_menit", 20), maks_per_hari=g.get("maks_per_hari", 2000),
                               jeda_detik=g.get("jeda_setelah_kuota_habis_detik", 60),
                               batas_waktu_detik=g.get("batas_waktu_detik", 10), keepalive_detik=self.keepalive)
            self.stt = PengenalSuara(s.stt_provider, lokal, groq)
            self.tts = buat_tts(s.tts_provider, s.path(s.piper_model_path))

    def _siapkan_topik(self, cfg: dict):
        """Penyemat kalimat + pembuat PelacakTopik per sesi. (None, None) jika deteksi topik dimatikan/tanpa model."""
        if not cfg.get("aktif", True):
            return None, None
        from config.settings import ROOT

        cadangan = self.intent._impl if self.intent.jenis == "indobert" else None
        penyemat = PenyematTopik(ROOT / cfg.get("model_dir", "models/topik-minilm"), cadangan)
        if not penyemat.aktif:
            return None, None
        ambang = cfg.get("ambang", {})
        ambang = ambang.get(penyemat.jenis, 0.55) if isinstance(ambang, dict) else float(ambang)
        opsi = {"ambang": ambang, "maks_lama": cfg.get("maks_topik_lama", 3), "maks_giliran": cfg.get("maks_giliran", 4),
                "ringkasan_maks_kata": cfg.get("ringkasan_maks_kata", 12), "kata_pendek": cfg.get("kata_pendek", 3),
                "maks_kata_rujukan": cfg.get("maks_kata_rujukan", 8), "giliran_maks_kata": self.riwayat_maks_kata}
        if cfg.get("pola_rujukan"):
            opsi["pola_rujukan"] = cfg["pola_rujukan"]
        return penyemat, (lambda: PelacakTopik(**opsi))

    def status(self) -> dict:
        s = self.settings
        kuota = self.chat.status_kuota()
        groq_stt = getattr(self.stt, "groq", None) if self.stt else None
        return {
            "intent": self.intent.jenis,
            "emosi": self.emotion.jenis,
            "llm": self.chat.nama,
            "gemini_kuota": kuota.get("gemini"),
            "whisper": (self.stt.ukuran if self.stt and self.stt.aktif else "tidak_aktif"),
            "vad": ("silero" if self.vad and self.vad.aktif else "energi"),
            "tts": self.tts.nama,
            "sesi_aktif": self.sessions.jumlah(),
            "topik": self.penyemat_topik.jenis if self.penyemat_topik else "tidak_aktif",
            "stt_provider": s.stt_provider,
            "llm_provider": s.llm_provider,
            "groq_model": self.chat.model_aktif("groq"),
            "gemini_model": self.chat.model_aktif("gemini"),
            "kunci": {"groq": bool(s.groq_api_key), "gemini": bool(s.gemini_api_key)},
            "stt": self.stt.status() if self.stt else None,
            "kuota": {
                "groq_whisper": groq_stt.status() if groq_stt else None,
                "groq_llm": kuota.get("groq"),
                "gemini": kuota.get("gemini"),
            },
            "pemanasan_koneksi": self.hasil_pemanasan_koneksi,
        }

    async def pemanasan_koneksi(self, batas_waktu: float = 8) -> dict:
        """Membuka koneksi HTTP ke Groq/Gemini saat startup. Gagal atau lambat tidak menghentikan server."""
        import asyncio

        mulai = time.perf_counter()
        tugas = {"llm": self.chat.pemanasan_koneksi()}
        groq_stt = getattr(self.stt, "groq", None) if self.stt else None
        if groq_stt is not None:
            tugas["groq_whisper"] = groq_stt.pemanasan()
        try:
            hasil = await asyncio.wait_for(asyncio.gather(*tugas.values(), return_exceptions=True), batas_waktu)
        except asyncio.TimeoutError:
            hasil = [TimeoutError()] * len(tugas)
        keluar: dict = {}
        for nama, h in zip(tugas, hasil):
            if isinstance(h, BaseException):
                keluar[nama] = {"ok": False, "galat": type(h).__name__}
            elif nama == "llm":
                keluar.update({f"{n}_llm" if n == "groq" else n: v for n, v in h.items()})
            else:
                keluar[nama] = h
        keluar["total_ms"] = _ms(mulai)
        self.hasil_pemanasan_koneksi = keluar
        log_event("pemanasan_koneksi", **keluar)
        return keluar

    def pemanasan(self) -> int:
        """Satu inferensi dummy supaya permintaan pertama pasien tidak lambat. Mengembalikan lama (ms)."""
        mulai = time.perf_counter()
        self.intent.predict("halo selamat pagi")
        self.emotion.predict_proba("halo selamat pagi")
        if self.penyemat_topik is not None:
            self.penyemat_topik.vektor("halo selamat pagi")
        if self.stt is not None and self.settings.stt_provider == "lokal":
            self.stt.pemanasan()
        return _ms(mulai)

    def greeting(self, id_kasur: str, persona: str | None, umur: int | None, nama_panggilan: str = "") -> HasilUcapan:
        """Dipanggil backend saat perawat mengaktifkan tablet. Sesi lama di kasur itu dihapus."""
        persona = pastikan_persona(persona, umur)
        self.sessions.reset(id_kasur)
        sesi = self.sessions.ambil(id_kasur)
        teks = sapaan_pertama(persona, nama_panggilan)
        sesi.balasan_terakhir = teks
        log_event("sapaan_pertama", id_kasur=id_kasur, persona=persona)
        return self._ucapan(teks, persona, "ramah")

    def reminder(self, id_kasur: str, jenis: str, persona: str | None, umur: int | None,
                 nama_panggilan: str = "", pesan_tambahan: str = "") -> HasilUcapan:
        """Dipanggil backend (pg_cron) saat jam pengingat yang diatur perawat tiba."""
        persona = pastikan_persona(persona, umur)
        sesi = self.sessions.ambil(id_kasur)
        teks = pengingat(jenis, persona, nama_panggilan, pesan_tambahan)
        sesi.balasan_terakhir = teks
        log_event("pengingat", id_kasur=id_kasur, jenis=jenis, persona=persona)
        return self._ucapan(teks, persona, visual_untuk(sesi.smoother.emosi_sekarang()))

    def siapkan_audio(self, audio_b64: str) -> np.ndarray:
        """Base64 → array 16 kHz. Melempar AudioError jika rusak, RuntimeError jika STT tidak aktif."""
        if self.stt is None or not self.stt.aktif:
            raise RuntimeError("Whisper tidak aktif di server ini")
        audio = load_audio(decode_base64(audio_b64))
        if durasi_detik(audio) > self.maks_detik_audio:
            log_warning("audio_dipotong", detik=round(durasi_detik(audio), 1), maks=self.maks_detik_audio)
            audio = audio[-int(self.maks_detik_audio * SAMPLE_RATE):]
        return audio

    def _potong_hening(self, audio: np.ndarray) -> np.ndarray | None:
        """Hening di awal/akhir dibuang dulu, supaya Whisper memproses audio sesingkat mungkin."""
        return audio if self.vad is None else self.vad.potong_hening(audio)

    def _tanpa_ucapan(self, id_kasur: str, waktu_stt: int, penyedia_stt: str) -> HasilPipeline:
        sesi = self.sessions.ambil(id_kasur)
        emosi = sesi.smoother.emosi_sekarang()
        hasil = HasilPipeline("", 0.0, "tidak_ada_ucapan", "hijau", "", emosi, visual_untuk(emosi), "", False)
        hasil.waktu["stt_ms"], hasil.penyedia["stt"] = waktu_stt, penyedia_stt
        return hasil

    def _ada_ucapan(self, stt) -> bool:
        return stt is not None and not (not stt.teks.strip() and stt.no_speech >= self.max_no_speech)

    def _keyakinan(self, stt) -> float:
        return 0.0 if stt.no_speech > self.max_no_speech else stt.keyakinan

    def process_audio(self, id_kasur: str, audio_b64: str, umur: int | None, persona: str | None,
                      jumlah_tanya_ulang: int = 0, nama_panggilan: str = "", stt_provider: str | None = None,
                      llm_provider: str | None = None) -> HasilPipeline:
        """`stt_provider` dan `llm_provider` mengganti pilihan .env untuk satu permintaan (hanya dari /demo)."""
        mulai = time.perf_counter()
        audio = self.siapkan_audio(audio_b64)
        with self._antrean:
            ucapan = self._potong_hening(audio)
            stt = self.stt.transcribe(ucapan, stt_provider) if ucapan is not None else None
        waktu_stt = _ms(mulai)
        penyedia_stt = stt.penyedia if stt is not None else "-"
        if not self._ada_ucapan(stt):
            return self._selesai(self._tanpa_ucapan(id_kasur, waktu_stt, penyedia_stt), mulai, id_kasur, None)
        return self.process_text(id_kasur, stt.teks, self._keyakinan(stt), umur, persona, jumlah_tanya_ulang,
                                 nama_panggilan, mulai, llm_provider=llm_provider,
                                 _stt=(waktu_stt, penyedia_stt), _ciri=self._ciri(ucapan))

    def _ringkas(self, teks: str) -> str:
        kata = teks.split()
        return " ".join(kata[: self.riwayat_maks_kata]) + (" ..." if len(kata) > self.riwayat_maks_kata else "")

    def _ciri(self, ucapan: np.ndarray | None):
        """Ciri nada suara untuk petunjuk emosi. Galat di sini tidak boleh menggagalkan percakapan."""
        if ucapan is None or not self.nada.aktif:
            return None
        try:
            return ciri_suara(ucapan)
        except Exception as e:
            log_warning("ciri_suara_gagal", error=type(e).__name__)
            return None

    def _analisa(self, id_kasur: str, teks: str, keyakinan: float, umur: int | None, persona: str | None,
                 jumlah_tanya_ulang: int, nama_panggilan: str, _stt: tuple[int, str] = (0, "-"),
                 _ciri=None) -> Analisis:
        """Langkah 2 sampai 4: semua yang tidak butuh LLM. Hasilnya sudah berisi level alarm lokal.

        Jika `konteks` None, `hasil.balasan_teks` sudah final (tanya ulang atau perintah perangkat).
        """
        waktu = {"stt_ms": _stt[0], "nlu_ms": 0, "llm_pertama_ms": 0, "llm_ms": 0, "total_ms": 0}
        penyedia = {"stt": _stt[1], "llm": "-"}
        persona = pastikan_persona(persona, umur)
        sesi = self.sessions.ambil(id_kasur)
        sesi.nada.terakhir = None
        mulai_nlu = time.perf_counter()
        aturan = self.rules.check(teks)

        if keyakinan < self.min_keyakinan or not teks.strip():
            emosi = sesi.smoother.emosi_sekarang()
            if teks.strip():
                probs = self.nada.gabung(_ciri, sesi.nada, self.emotion.predict_proba(teks))
                kuat = max(p for lb, p in probs.items() if lb != "netral")
                if sesi.smoother.ambang_langsung is not None and kuat >= sesi.smoother.ambang_langsung:
                    emosi = sesi.smoother.tambah(probs)
            visual = visual_untuk(emosi)
            if aturan.level == "merah":
                balasan = f"{balasan_cadangan('alarm', persona, nama_panggilan)} Boleh diulang pelan-pelan?"
                hasil = HasilPipeline(teks, keyakinan, "darurat", "merah", ringkasan_lokal(teks, "merah"),
                                      emosi, visual, balasan, True, ekspresi="serius")
            elif jumlah_tanya_ulang < self.maks_tanya_ulang:
                balasan = "Maaf, aku kurang dengar. Bisa diulang?" if persona == "remaja" \
                    else "Maaf, saya kurang dengar. Bisa diulang?"
                hasil = HasilPipeline(teks, keyakinan, "tidak_jelas", "hijau", "", emosi, visual, balasan, True)
            else:
                balasan = "Aku panggilin perawat ya, biar dibantu langsung." if persona == "remaja" \
                    else "Saya panggilkan perawat ya, supaya bisa dibantu langsung."
                hasil = HasilPipeline(teks, keyakinan, "tidak_jelas", "oranye",
                                      "Ucapan pasien tidak jelas setelah tanya ulang", emosi, visual, balasan, False,
                                      ekspresi="serius")
            waktu["nlu_ms"] = _ms(mulai_nlu)
            hasil.waktu, hasil.penyedia = waktu, penyedia
            return Analisis(hasil, persona, nama_panggilan, hasil.level_alarm)

        maksud, _ = self.intent.predict(teks)
        if self.penurun.berlaku(normalisasi(teks), aturan.level, maksud):
            log_event("level_diturunkan", id_kasur=id_kasur, maksud_asli=maksud,
                      level_asli=level_dari_maksud(maksud), ke="hijau")
            maksud = "ngobrol"
        lokal = level_lokal(aturan.level, maksud)
        probs = self.nada.gabung(_ciri, sesi.nada, self.emotion.predict_proba(teks))
        emosi = sesi.smoother.tambah(probs)
        visual = visual_untuk(emosi)
        ka, kategori_tanya = None, ""
        if self.konteks_alarm.aktif:
            lokal, maksud, ka, kategori_tanya = self._periksa_konteks(sesi, teks, lokal, maksud, aturan.level, emosi)
        waktu["nlu_ms"] = _ms(mulai_nlu)
        ringkasan = ringkasan_lokal(teks, lokal) if lokal != "hijau" else ""
        if ka is not None and ka.dikonfirmasi and lokal != "hijau":
            ringkasan = f"Pasien membenarkan {NAMA_KELUHAN.get(ka.dikonfirmasi, 'tidak enak badan')} saat ditanya Vine"

        if kategori_tanya:
            hormat = sapaan_hormat(bersihkan_panggilan(nama_panggilan) or "", persona)
            tanya = muat_gaya()["konfirmasi_alarm"].get(kategori_tanya, muat_gaya()["konfirmasi_alarm"]["lain"])
            balasan = tanya.format(hormat=hormat)
            hasil = HasilPipeline(teks, keyakinan, maksud, "hijau", "", emosi, visual, balasan, False, ekspresi="tenang")
            hasil.waktu, hasil.penyedia = waktu, penyedia
            sesi.riwayat.append((self._ringkas(teks), balasan))
            sesi.balasan_terakhir = balasan
            if sesi.topik is not None:
                sesi.topik.proses(teks, self.penyemat_topik.vektor(teks))
                sesi.topik.catat_balasan(balasan)
            return Analisis(hasil, persona, nama_panggilan, "hijau", konteks_alarm=ka)

        if lokal == "hijau":
            cmd = commands.cocokkan(teks)
            if cmd:
                nama, balasan = cmd
                if nama == "ulangi":
                    balasan = sesi.balasan_terakhir or "Saya belum bilang apa-apa."
                hasil = HasilPipeline(teks, keyakinan, "perintah", "hijau", "", emosi, visual, balasan, False, nama)
                hasil.waktu, hasil.penyedia = waktu, penyedia
                if nama == "vine_off":
                    self.sessions.reset(id_kasur)
                    log_event("memori_dihapus", id_kasur=id_kasur, alasan="vine_off")
                return Analisis(hasil, persona, nama_panggilan, "hijau")

        hasil = HasilPipeline(teks, keyakinan, maksud, lokal, ringkasan, emosi, visual, "", False)
        hasil.waktu, hasil.penyedia = waktu, penyedia
        alarm = balasan_cadangan("alarm", persona, nama_panggilan) if lokal != "hijau" else ""
        topik = None
        if sesi.topik is not None:
            sesi.topik.proses(teks, self.penyemat_topik.vektor(teks))
            topik = sesi.topik.konteks()
            waktu["nlu_ms"] = _ms(mulai_nlu)
        konteks = KonteksBalasan(teks, persona, emosi, maksud, lokal, nama_panggilan,
                                 list(sesi.riwayat), self.jumlah_contoh, alarm_terucap=alarm,
                                 fakta=list(sesi.fakta), pembuka_terakhir=list(sesi.pembuka),
                                 template_terakhir=sesi.template_terakhir, topik=topik)
        return Analisis(hasil, persona, nama_panggilan, lokal, konteks, alarm, konteks_alarm=ka)

    def _periksa_konteks(self, sesi, teks: str, lokal: str, maksud: str, level_aturan: str | None, emosi: str):
        """Tahap 2 + jawaban konfirmasi. Mengembalikan (level, maksud, keputusan, kategori_tanya).

        Hanya kategori pemicu, keputusan, dan kategori alasan yang dicatat di log (tanpa teks).
        """
        topik = sesi.topik.aktif.ringkasan if sesi.topik is not None and sesi.topik.aktif is not None else ""
        ka = self.konteks_alarm.periksa(teks, lokal, dari_aturan=bool(level_aturan), emosi=emosi, topik=topik)
        if ka.keputusan != "tidak_ada":
            catat_konteks(ka)
        kategori_tanya = ""
        if ka.keputusan in ("turun", "tanya"):
            lokal, maksud = "hijau", "ngobrol"
        elif ka.keputusan == "langsung" and URUTAN[ka.level] > URUTAN[lokal]:
            lokal = ka.level
            maksud = "darurat" if lokal == "merah" else "bantuan"

        menunggu = sesi.menunggu_konfirmasi
        if menunggu:
            jawab = self.konteks_alarm.jawaban(teks, menunggu["kategori"])
            keputusan = {"ya": "konfirmasi_ya", "tidak": "konfirmasi_tidak"}.get(jawab)
            if jawab == "ya":
                lokal = tertinggi(lokal, menunggu["level"])
                ka.dikonfirmasi = menunggu["kategori"]
                maksud = menunggu["maksud"] if URUTAN[lokal] <= URUTAN[menunggu["level"]] else maksud
                sesi.menunggu_konfirmasi = None
            elif jawab == "tidak":
                sesi.menunggu_konfirmasi = None
            else:
                menunggu["sisa"] -= 1
                if menunggu["sisa"] <= 0:
                    sesi.menunggu_konfirmasi, keputusan = None, "konfirmasi_kedaluwarsa"
            if keputusan:
                log_event("konteks_alarm", pemicu=[menunggu["kategori"]], keputusan=keputusan, alasan=["jawaban"])

        if ka.keputusan == "tanya" and lokal == "hijau":
            kategori_tanya = ka.kategori_tanya
            sesi.menunggu_konfirmasi = {"kategori": kategori_tanya, "level": ka.level_kandidat,
                                        "maksud": "darurat" if ka.level_kandidat == "merah" else "bantuan",
                                        "sisa": self.konteks_alarm.berlaku_giliran}
        return lokal, maksud, ka, kategori_tanya

    def _level_dari_llm(self, a: Analisis, level_llm: str | None, alasan: str, id_kasur: str) -> str:
        """LLM hanya boleh menaikkan level. Untuk maksud pertanyaan_medis/ngobrol, harus ada alasan bergejala.

        Ucapan yang dinilai kiasan/masa lalu/orang lain/cerita/penyangkalan tidak boleh dinaikkan LLM sama sekali.
        """
        if a.konteks_alarm is not None and a.konteks_alarm.blok_kenaikan_llm:
            level, ditolak = a.level_lokal, URUTAN.get(level_llm or "hijau", 0) > URUTAN[a.level_lokal]
        else:
            level, ditolak = level_dengan_alasan(a.level_lokal, a.hasil.maksud, level_llm, alasan,
                                                 self.maksud_terkunci, self.pola_gejala,
                                                 a.hasil.teks_pasien if self.gejala_di_ucapan else None)
        if ditolak and (id_kasur, level_llm) not in a.tercatat:
            a.tercatat.add((id_kasur, level_llm))
            log_event("llm_kenaikan_ditolak", id_kasur=id_kasur, maksud=a.hasil.maksud, dari=a.level_lokal,
                      diminta=level_llm, ada_alasan=bool(alasan))
        return level

    def _penyaring(self, a: Analisis, level_fn) -> PenyaringKalimat:
        sesi = self.sessions.ambil(a.hasil_id) if a.hasil_id else None
        pj = panjang(a.persona)
        return PenyaringKalimat(a.persona, a.nama_panggilan, level_fn,
                                pembuka_terakhir=list(sesi.pembuka) if sesi else [],
                                maks_kalimat=pj["kalimat"][1], maks_kata=pj["maks_kata"],
                                maks_kalimat_alarm=aturan_alarm()["maks_kalimat"], maks_kata_total=pj["kata"][1],
                                min_kalimat=pj["kalimat"][0],
                                template_terakhir=a.konteks.template_terakhir if a.konteks else None,
                                teks_pasien=a.hasil.teks_pasien,
                                ada_ingatan=bool(sesi and (sesi.riwayat or sesi.fakta)),
                                balasan_sebelumnya=[v for _, v in sesi.riwayat] if sesi else [])

    def _ekspresi(self, nilai: str | None, level: str, emosi: str) -> str:
        return ekspresi_valid(nilai, level, emosi, self.ekspresi_bawaan)

    def _simpan_balasan(self, id_kasur: str, a: Analisis, kalimat: list[str], level: str,
                        ringkasan_llm: str = "", ingat: str = "") -> None:
        """Menetapkan level akhir dan ringkasan, lalu memperbarui memori sesi (RAM saja)."""
        h = a.hasil
        if URUTAN[level] > URUTAN[a.level_lokal]:
            log_event("llm_menaikkan_level", id_kasur=id_kasur, dari=a.level_lokal, ke=level, maksud=h.maksud)
        h.level_alarm = level
        h.ringkasan_alarm = (ringkasan_llm or ringkasan_lokal(h.teks_pasien, level)) if level != "hijau" else ""
        if level != "hijau" and a.konteks_alarm is not None and a.konteks_alarm.dikonfirmasi:
            keluhan = NAMA_KELUHAN.get(a.konteks_alarm.dikonfirmasi, "tidak enak badan")
            h.ringkasan_alarm = f"Pasien membenarkan {keluhan} saat ditanya Vine"
        h.balasan_teks = " ".join(kalimat)
        sesi = self.sessions.ambil(id_kasur)
        sesi.riwayat.append((self._ringkas(h.teks_pasien), self._ringkas(h.balasan_teks)))
        sesi.balasan_terakhir = h.balasan_teks
        if sesi.topik is not None:
            sesi.topik.catat_balasan(h.balasan_teks)
        if ingat:
            sesi.ingat(ingat)
        alarm = a.alarm or balasan_cadangan("alarm", a.persona, a.nama_panggilan)
        pertama = next((k for k in kalimat if k != alarm), "")
        if pertama:
            sesi.pembuka.append(pembuka(pertama))

    def process_text(self, id_kasur: str, teks: str, keyakinan: float = 1.0, umur: int | None = None,
                     persona: str | None = None, jumlah_tanya_ulang: int = 0, nama_panggilan: str = "",
                     mulai: float | None = None, llm_provider: str | None = None,
                     _stt: tuple[int, str] = (0, "-"), _ciri=None) -> HasilPipeline:
        mulai = mulai or time.perf_counter()
        a = self._analisa(id_kasur, teks, keyakinan, umur, persona, jumlah_tanya_ulang, nama_panggilan, _stt,
                          _ciri=_ciri)
        a.hasil_id = id_kasur
        if a.konteks is None:
            return self._selesai(a.hasil, mulai, id_kasur, a.persona)

        mulai_llm = time.perf_counter()
        jawaban, sumber = self.chat.balas(a.konteks, llm_provider)
        a.hasil.waktu["llm_ms"] = a.hasil.waktu["llm_pertama_ms"] = _ms(mulai_llm)
        level = self._level_dari_llm(a, jawaban.level, jawaban.alasan, id_kasur)

        kalimat: list[str] = []
        saring = self._penyaring(a, lambda: level)
        if level != "hijau":
            kalimat.append(a.alarm or balasan_cadangan("alarm", a.persona, nama_panggilan))
            saring.catat_alarm(kalimat[-1])
        for kal in pecah_kalimat(jawaban.balasan, self.min_kata_kalimat):
            k = saring.olah(kal)
            if k:
                kalimat.append(k)
        if saring.diblokir:
            log_event("guardrail_memblokir", id_kasur=id_kasur)
        tertahan = saring.ambil_tertahan()
        if tertahan:
            kalimat.append(tertahan)
        if not saring.dari_llm:
            sumber, jawaban.model = "template", ""
            a.konteks.alarm_terucap = a.konteks.alarm_terucap or (kalimat[0] if kalimat else "")
            cadangan = self.chat.template.balas(a.konteks)
            jawaban.ekspresi = cadangan.ekspresi
            for kal in pecah_kalimat(cadangan.balasan, self.min_kata_kalimat):
                k = saring.olah(kal)
                if k:
                    kalimat.append(k)
        if saring.dibuang:
            log_event("kalimat_dibuang", id_kasur=id_kasur, alasan=saring.dibuang)
        a.hasil.sumber_balasan = sumber
        a.hasil.penyedia["llm"] = f"{sumber}:{jawaban.model}" if jawaban.model else sumber
        a.hasil.ekspresi = self._ekspresi(jawaban.ekspresi, level, a.hasil.emosi)
        self._simpan_balasan(id_kasur, a, kalimat, level, jawaban.ringkasan, jawaban.ingat)
        return self._selesai(a.hasil, mulai, id_kasur, a.persona)

    async def converse_stream(self, id_kasur: str, *, teks: str | None = None, audio: np.ndarray | None = None,
                              keyakinan: float = 1.0, umur: int | None = None, persona: str | None = None,
                              jumlah_tanya_ulang: int = 0, nama_panggilan: str = "",
                              stt_provider: str | None = None, llm_provider: str | None = None
                              ) -> AsyncIterator[tuple[str, dict]]:
        """Alarm dulu, lalu balasan per kalimat. Menghasilkan (nama_event, data):

        analisis → kalimat (0 atau lebih) → selesai. Jika terjadi galat tak terduga: galat.
        `audio` sudah dibaca dengan siapkan_audio() oleh handler, supaya audio rusak menjadi HTTP 422.
        """
        import anyio

        mulai = time.perf_counter()
        try:
            _stt = (0, "-")
            ciri = None
            if audio is not None:
                def potong():
                    with self._antrean:
                        return self._potong_hening(audio)

                ucapan = await anyio.to_thread.run_sync(potong)
                stt = None if ucapan is None else await self.stt.transcribe_async(ucapan, stt_provider, self._antrean)
                _stt = (_ms(mulai), stt.penyedia if stt is not None else "-")
                if not self._ada_ucapan(stt):
                    hasil = self._tanpa_ucapan(id_kasur, *_stt)
                    yield "analisis", self._data_analisis(hasil)
                    yield "selesai", self._data_selesai(hasil, mulai, id_kasur, None)
                    return
                teks, keyakinan = stt.teks, self._keyakinan(stt)
                ciri = await anyio.to_thread.run_sync(lambda: self._ciri(ucapan))

            a = await anyio.to_thread.run_sync(
                lambda: self._analisa(id_kasur, teks or "", keyakinan, umur, persona, jumlah_tanya_ulang,
                                      nama_panggilan, _stt, _ciri=ciri))
            a.hasil_id = id_kasur
            yield "analisis", self._data_analisis(a.hasil)

            kecepatan = float(self.kecepatan.get(a.persona, 1.0))
            if a.konteks is None:
                for i, kal in enumerate(pecah_kalimat(a.hasil.balasan_teks, self.min_kata_kalimat)):
                    yield "kalimat", {"teks": kal, "urutan": i, "kecepatan_bicara": kecepatan,
                                      "ekspresi": a.hasil.ekspresi}
                yield "selesai", self._data_selesai(a.hasil, mulai, id_kasur, a.persona)
                return

            async for nama, data in self._stream_balasan(id_kasur, a, llm_provider, kecepatan):
                yield nama, data
            yield "selesai", self._data_selesai(a.hasil, mulai, id_kasur, a.persona)
        except Exception as e:
            log_error("stream_gagal", id_kasur=id_kasur, error=type(e).__name__, detail=str(e)[:200])
            yield "galat", {"pesan": "Terjadi galat di ml-service. Alarm lokal tetap berlaku jika sudah terkirim.",
                            "jenis": type(e).__name__}

    async def _stream_balasan(self, id_kasur: str, a: Analisis, llm_provider: str | None,
                              kecepatan: float) -> AsyncIterator[tuple[str, dict]]:
        """Langkah 5 dan 6 versi streaming: alarm dari kode, lalu LLM per kalimat yang sudah disaring."""
        h, persona, nama = a.hasil, a.persona, a.nama_panggilan
        terkirim: list[str] = []
        header = PenguraiHeader()
        pemecah = PemecahKalimat(self.min_kata_kalimat)
        mulai_llm = time.perf_counter()

        def level_sekarang() -> str:
            return self._level_dari_llm(a, header.level, header.data.get("alasan", ""), id_kasur)

        saring = self._penyaring(a, level_sekarang)

        def event(kalimat: str, ekspresi: str) -> tuple[str, dict]:
            if h.waktu["llm_pertama_ms"] == 0 and saring.dari_llm:
                h.waktu["llm_pertama_ms"] = _ms(mulai_llm)
            terkirim.append(kalimat)
            return "kalimat", {"teks": kalimat, "urutan": len(terkirim) - 1, "kecepatan_bicara": kecepatan,
                               "ekspresi": ekspresi}

        def alarm_event() -> tuple[str, dict]:
            teks_alarm = a.alarm or balasan_cadangan("alarm", persona, nama)
            saring.catat_alarm(teks_alarm)
            return event(teks_alarm, "serius")

        if a.alarm:
            yield alarm_event()

        def olah(kal: str) -> list[tuple[str, dict]]:
            keluar = []
            if not saring.info_perawat and level_sekarang() != "hijau":
                keluar.append(alarm_event())
            k = saring.olah(kal)
            if k:
                keluar.append(event(k, self._ekspresi(header.data.get("ekspresi"), level_sekarang(), h.emosi)))
            return keluar

        sumber, model = "template", ""
        if not saring.selesai:
            async with aclosing(self.chat.balas_stream(a.konteks, llm_provider)) as aliran:
                async for sumber, model, potongan in aliran:
                    for kal in pemecah.tambah(header.tambah(potongan)):
                        for ev in olah(kal):
                            yield ev
                    if saring.selesai:
                        break
            if not saring.selesai:
                for kal in pemecah.tambah(header.selesai()) + pemecah.selesai():
                    for ev in olah(kal):
                        yield ev
        if saring.diblokir:
            log_event("guardrail_memblokir", id_kasur=id_kasur, kalimat_ke=len(terkirim))

        tertahan = saring.ambil_tertahan()
        if tertahan:
            yield event(tertahan, self._ekspresi(header.data.get("ekspresi"), level_sekarang(), h.emosi))
        if not saring.dari_llm:
            sumber, model = "template", ""
            if saring.info_perawat and not a.konteks.alarm_terucap:
                a.konteks.alarm_terucap = balasan_cadangan("alarm", persona, nama)
            cadangan = self.chat.template.balas(a.konteks)
            header.data["ekspresi"] = cadangan.ekspresi
            for kal in pecah_kalimat(cadangan.balasan, self.min_kata_kalimat):
                k = saring.olah(kal)
                if k:
                    yield event(k, self._ekspresi(cadangan.ekspresi, level_sekarang(), h.emosi))
        if saring.dibuang:
            log_event("kalimat_dibuang", id_kasur=id_kasur, alasan=saring.dibuang)

        h.waktu["llm_ms"] = _ms(mulai_llm)
        h.sumber_balasan = sumber
        h.penyedia["llm"] = f"{sumber}:{model}" if model else sumber
        h.ekspresi = self._ekspresi(header.data.get("ekspresi"), level_sekarang(), h.emosi)
        self._simpan_balasan(id_kasur, a, terkirim, level_sekarang(), ingat=header.data.get("ingat", ""))

    def _data_analisis(self, h: HasilPipeline) -> dict:
        return {
            "teks_pasien": h.teks_pasien, "skor_keyakinan": h.skor_keyakinan, "maksud": h.maksud,
            "level_alarm": h.level_alarm, "ringkasan_alarm": h.ringkasan_alarm, "emosi": h.emosi,
            "visual_vine": h.visual_vine, "perlu_tanya_ulang": h.perlu_tanya_ulang, "perintah": h.perintah,
            "waktu": {"stt_ms": h.waktu["stt_ms"], "nlu_ms": h.waktu["nlu_ms"]},
            "penyedia": {"stt": h.penyedia["stt"]},
        }

    def _log_suara(self, h: HasilPipeline, id_kasur: str) -> dict:
        """Untuk menyetel ambang: skor keyakinan STT dan petunjuk nada suara (tanpa isi ucapan)."""
        sesi = self.sessions.lihat(id_kasur)
        return {"keyakinan": round(float(h.skor_keyakinan or 0.0), 2),
                "nada": sesi.nada.terakhir if sesi is not None else None}

    def _data_selesai(self, h: HasilPipeline, mulai: float, id_kasur: str, persona: str | None) -> dict:
        h.kecepatan_bicara = float(self.kecepatan.get(persona or "dewasa", 1.0))
        h.waktu_proses_ms = h.waktu["total_ms"] = _ms(mulai)
        log_event("stream_selesai", id_kasur=id_kasur, maksud=h.maksud, level=h.level_alarm, emosi=h.emosi,
                  ekspresi=h.ekspresi, sumber=h.sumber_balasan, waktu_ms=h.waktu, penyedia=h.penyedia,
                  **self._log_suara(h, id_kasur))
        return {
            "balasan_teks": h.balasan_teks, "sumber_balasan": h.sumber_balasan, "level_alarm": h.level_alarm,
            "ringkasan_alarm": h.ringkasan_alarm, "kecepatan_bicara": h.kecepatan_bicara, "ekspresi": h.ekspresi,
            "penyedia": dict(h.penyedia),
            "waktu": {"stt_ms": h.waktu["stt_ms"], "nlu_ms": h.waktu["nlu_ms"],
                      "llm_pertama_ms": h.waktu["llm_pertama_ms"], "llm_total_ms": h.waktu["llm_ms"],
                      "total_ms": h.waktu["total_ms"]},
        }

    def reset(self, id_kasur: str) -> bool:
        return self.sessions.reset(id_kasur)

    def _suara(self, teks: str, persona: str | None) -> tuple[float, str | None]:
        kecepatan = float(self.kecepatan.get(persona or "dewasa", 1.0))
        if not teks:
            return kecepatan, None
        try:
            return kecepatan, self.tts.synthesize(teks, kecepatan)
        except Exception as e:
            log_warning("tts_gagal", error=str(e)[:200])
            return kecepatan, None

    def _ucapan(self, teks: str, persona: str, visual: str) -> HasilUcapan:
        kecepatan, audio = self._suara(teks, persona)
        return HasilUcapan(teks, visual, kecepatan, audio)

    def _selesai(self, hasil: HasilPipeline, mulai: float, id_kasur: str, persona: str | None,
                 waktu: dict | None = None, penyedia: dict | None = None) -> HasilPipeline:
        hasil.kecepatan_bicara, hasil.balasan_audio = self._suara(hasil.balasan_teks, persona)
        hasil.waktu_proses_ms = _ms(mulai)
        if waktu is not None:
            hasil.waktu = waktu
        if penyedia is not None:
            hasil.penyedia = penyedia
        hasil.waktu["total_ms"] = hasil.waktu_proses_ms
        log_event("proses_selesai", id_kasur=id_kasur, maksud=hasil.maksud, level=hasil.level_alarm,
                  emosi=hasil.emosi, sumber=hasil.sumber_balasan, ms=hasil.waktu_proses_ms,
                  waktu_ms=hasil.waktu, penyedia=hasil.penyedia, **self._log_suara(hasil, id_kasur))
        return hasil
