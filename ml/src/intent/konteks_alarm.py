"""Tahap 2 penentuan alarm: pemeriksa konteks untuk SEMUA kata pemicu.

Tahap 1 (kata_darurat + IndoBERT, seperti sebelumnya) menghasilkan level kandidat. Modul ini memeriksa apakah
pemicunya benar-benar keluhan yang dialami pasien SEKARANG, atau curhat:
- kiasan/perasaan ("mau mati bosan", "sakit hati", "jatuh cinta", "pusing mikirin", "napas lega")
- masa lalu ("dulu", "pernah", "tahun lalu"), orang lain ("anak saya ..."), cerita/film/berita/mimpi,
  penyangkalan ("sudah tidak sesak", "sudah membaik")
Emosi pasien dan topik aktif (perasaan/keluarga/kenangan) memperkuat penurunan, kecuali ada bagian tubuh atau
gejala yang dialami sekarang.

Tidak pernah diturunkan: permintaan perawat eksplisit, ide bunuh diri/menyakiti diri, gejala berat yang
jelas dialami sekarang. Ragu → level hijau dan Vine bertanya konfirmasi (status disimpan di sesi, RAM saja).

Keputusan: "tidak_ada" (kandidat hijau), "langsung", "tetap", "turun", "tanya".
Semua pola ada di config/thresholds.yaml (konteks_alarm). Modul ini tidak menyimpan atau mencatat teks.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from config.settings import get_thresholds
from src.intent.decide_level import URUTAN, tertinggi
from src.intent.safety_rules import _kompilasi, normalisasi
from src.utils.logger import log_event

KONTEKS_TANPA_KENAIKAN = ("kiasan", "masa_lalu", "orang_lain", "cerita", "penyangkalan")
URUTAN_KATEGORI = ("napas", "dada", "pingsan", "kejang", "darah", "jatuh", "sakit", "pusing", "mual", "demam",
                   "lemas", "infus", "toilet", "tolong", "mati", "takut")
NAMA_KELUHAN = {"napas": "sesak napas", "dada": "nyeri/berdebar di dada", "pingsan": "rasa mau pingsan",
                "kejang": "kejang", "darah": "perdarahan", "jatuh": "risiko jatuh", "sakit": "rasa sakit",
                "pusing": "pusing", "mual": "mual", "demam": "demam", "lemas": "lemas/kebas", "infus": "masalah infus",
                "toilet": "butuh bantuan ke toilet"}
_PEMISAH = re.compile(r"[.,!?;:\n]+|\s+(?=(?:tapi|tetapi|namun|padahal|sedangkan|sekarang)\b)"
                      r"|\s+(?=(?:terus|kemudian|habis itu|setelah itu)\s+(?:saya|aku|kepala|dada|perut|badan|"
                      r"tangan|kaki|napas|nafas|jantung)\b)")


@dataclass
class Klausa:
    teks: str
    pemicu: list[str]
    status: str = "tanpa_pemicu"
    alasan: list[str] = field(default_factory=list)
    berat: bool = False
    diri: bool = False


@dataclass
class KeputusanAlarm:
    keputusan: str
    level: str
    level_kandidat: str
    pemicu: list[str] = field(default_factory=list)
    alasan: list[str] = field(default_factory=list)
    kategori_tanya: str = ""
    dikonfirmasi: str = ""

    @property
    def blok_kenaikan_llm(self) -> bool:
        """LLM tidak boleh menaikkan level untuk ucapan kiasan/masa lalu/orang lain/cerita/penyangkalan."""
        return self.level == "hijau" and any(a in KONTEKS_TANPA_KENAIKAN for a in self.alasan)


def _re(p: str | None) -> re.Pattern | None:
    return re.compile(p) if p else None


class PemeriksaKonteks:
    def __init__(self, cfg: dict | None = None):
        cfg = cfg if cfg is not None else get_thresholds().get("konteks_alarm", {})
        self.aktif = bool(cfg.get("aktif", False))
        self.pemicu = {k: re.compile(v) for k, v in (cfg.get("pemicu") or {}).items()}
        self.kat_berat = set(cfg.get("berat", []))
        self.kat_perasaan = set(cfg.get("perasaan", ["takut"]))
        langsung = cfg.get("langsung") or {}
        self.bunuh_diri = _kompilasi(langsung.get("bunuh_diri", []))
        self.permintaan = _kompilasi(langsung.get("permintaan", []))
        self.kiasan = [re.compile(p) for p in cfg.get("kiasan", [])]
        self.masa_lalu = _re(cfg.get("masa_lalu"))
        self.bukan_masa_lalu = _re(cfg.get("bukan_masa_lalu"))
        self.sekarang = _re(cfg.get("sekarang"))
        self.orang_lain = _re(cfg.get("orang_lain"))
        self.jauh = _re(cfg.get("jauh"))
        self.cerita = _re(cfg.get("cerita"))
        ps = cfg.get("penyangkalan") or {}
        self.neg_kata, self.neg_bukan, self.pulih = _re(ps.get("kata")), _re(ps.get("bukan")), _re(ps.get("pulih"))
        rg = cfg.get("ragu") or {}
        self.sebab_perasaan, self.tidak_pasti = _re(rg.get("sebab_perasaan")), _re(rg.get("tidak_pasti"))
        self.penguat = _re(rg.get("penguat"))
        self.bagian_tubuh = _re(cfg.get("bagian_tubuh"))
        self.emosi_penguat = set(cfg.get("emosi_penguat", []))
        self.topik_penguat = _re(cfg.get("topik_penguat"))
        self.jangan_turunkan = _re(cfg.get("jangan_turunkan"))
        kf = cfg.get("konfirmasi") or {}
        self.berlaku_giliran = int(kf.get("berlaku_giliran", 2))
        self.jawab_ya, self.jawab_tidak = _re(kf.get("ya")), _re(kf.get("tidak"))
        self.kat_bukan_gejala = self.kat_perasaan | {"tolong", "mati"}
        gejala = [v.pattern for k, v in self.pemicu.items() if k not in self.kat_bukan_gejala]
        self._gejala = re.compile("|".join(f"(?:{g})" for g in gejala)) if gejala else None
        self._diri_gejala = re.compile(
            r"\b(saya|aku)\s+((merasa|rasa|jadi|agak|sedang|lagi|sangat|mau|hampir|habis|baru|sudah|masih|sering|"
            r"kadang|tiba tiba|mendadak|kok)\s+){0,2}(" + "|".join(gejala) + ")") if gejala else None
        self._diri_tubuh = re.compile(rf"(?:{self.bagian_tubuh.pattern})( \w+)? (saya|aku|ku)\b") \
            if self.bagian_tubuh else None

    @staticmethod
    def _cocok(daftar, t: str) -> bool:
        return any(p.search(t) and not (k and k.search(t)) for p, k in daftar)

    def langsung(self, teks: str) -> str | None:
        """"bunuh_diri" / "permintaan" / None. Diperiksa pada teks asli, sebelum konteks apa pun."""
        t = normalisasi(teks)
        if self._cocok(self.bunuh_diri, t):
            return "bunuh_diri"
        if self._cocok(self.permintaan, t):
            return "permintaan"
        return None

    def _buang_kiasan(self, t: str) -> tuple[str, bool]:
        dibuang = False
        for p in self.kiasan:
            t, n = p.subn(" ", t)
            dibuang = dibuang or n > 0
        return " ".join(t.split()), dibuang

    def _kategori(self, t: str) -> list[str]:
        return [k for k, p in self.pemicu.items() if p.search(t)]

    def _disangkal(self, t: str) -> bool:
        """Semua pemicu di klausa disangkal ("sudah tidak sesak", "nggak sakit kok", "sudah membaik")."""
        if self.pulih:
            for m in self.pulih.finditer(t):
                sebelum = t[:m.start()].split()[-2:]
                if not (self.neg_kata and any(self.neg_kata.fullmatch(w) for w in sebelum)):
                    return True
        if not self.neg_kata:
            return False
        kata = t.split()
        posisi_neg = [i for i, w in enumerate(kata) if self.neg_kata.fullmatch(w)
                      and not (self.neg_bukan and self.neg_bukan.search(" ".join(kata[i + 1:i + 3])))]
        if not posisi_neg:
            return False
        posisi_pemicu = {t[:m.start()].count(" ") for p in self.pemicu.values() for m in p.finditer(t)
                         if not (self.bagian_tubuh and self.bagian_tubuh.fullmatch(m.group(0)))}
        return bool(posisi_pemicu) and all(any(0 < i - j <= 3 for j in posisi_neg) for i in posisi_pemicu)

    def _diri(self, t: str) -> bool:
        """Gejala atau bagian tubuh milik pasien sendiri ("dada saya", "saya sesak"), bukan "anak saya pusing"."""
        bersih = self.orang_lain.sub(" ", t) if self.orang_lain else t
        return bool((self._diri_tubuh and self._diri_tubuh.search(bersih))
                    or (self._diri_gejala and self._diri_gejala.search(bersih)))

    def _klausa(self, teks: str) -> list[Klausa]:
        hasil, bingkai = [], set()
        for bagian in _PEMISAH.split(teks.lower()):
            t = normalisasi(bagian or "")
            if not t:
                continue
            t, _ = self._buang_kiasan(t)
            k = Klausa(t, self._kategori(t))
            sekarang = bool(self.sekarang and self.sekarang.search(t))
            t_lampau = self.bukan_masa_lalu.sub(" ", t) if self.bukan_masa_lalu else t
            lampau = bool(self.masa_lalu and self.masa_lalu.search(t_lampau))
            cerita = bool(self.cerita and self.cerita.search(t))
            lain = bool(self.orang_lain and self.orang_lain.search(t))
            k.diri = self._diri(t)
            k.berat = bool(set(k.pemicu) & self.kat_berat)
            if k.pemicu:
                self._nilai(k, t, sekarang, lampau, cerita, lain, bingkai)
            if sekarang:
                bingkai = set()
            elif cerita or lampau:
                bingkai = {"cerita"} if cerita else {"masa_lalu"}
            hasil.append(k)
        return hasil

    def _nilai(self, k: Klausa, t: str, sekarang: bool, lampau: bool, cerita: bool, lain: bool, bingkai: set):
        def turun(*alasan):
            k.status, k.alasan = "turun", list(alasan)

        if self._disangkal(t):
            return turun("penyangkalan")
        if cerita:
            return turun("cerita")
        if lain and not k.diri:
            jauh = bool(self.jauh and self.jauh.search(t))
            if k.berat and not (lampau or jauh):
                k.status, k.alasan = "nyata", ["orang_lain_dekat"]
                return None
            return turun("orang_lain", *(["masa_lalu"] if lampau else []))
        if lampau and not sekarang:
            return turun("masa_lalu")
        if bingkai and not sekarang and not lampau:
            if "cerita" in bingkai:
                if k.diri:
                    k.status, k.alasan = "nyata", ["gejala_sendiri"]
                    return None
                return turun("cerita")
            if k.diri:
                k.status, k.alasan = "ragu", ["masa_lalu"]
                return None
            return turun("masa_lalu")
        if set(k.pemicu) <= self.kat_perasaan:
            return turun("kiasan")
        ragu = bool((self.sebab_perasaan and self.sebab_perasaan.search(t))
                    or (self.tidak_pasti and self.tidak_pasti.search(t)))
        if ragu and not (k.berat and self.penguat and self.penguat.search(t)):
            k.status, k.alasan = "ragu", ["tidak_pasti"]
            return None
        k.status = "nyata"
        return None

    def _penguat(self, emosi: str, topik: str) -> list[str]:
        alasan = []
        if emosi in self.emosi_penguat:
            alasan.append("emosi")
        if topik and self.topik_penguat and self.topik_penguat.search(topik.lower()):
            alasan.append("topik")
        return alasan

    def periksa(self, teks: str, level_kandidat: str, dari_aturan: bool = False, emosi: str = "netral",
                topik: str = "") -> KeputusanAlarm:
        """`dari_aturan`: kandidat (juga) berasal dari kata_darurat, bukan hanya IndoBERT."""
        jalan_langsung = self.langsung(teks)
        if jalan_langsung:
            minimum = "merah" if jalan_langsung == "bunuh_diri" else "oranye"
            return KeputusanAlarm("langsung", tertinggi(level_kandidat, minimum), level_kandidat,
                                  ["tolong" if jalan_langsung == "permintaan" else "bunuh_diri"], [jalan_langsung])
        klausa = self._klausa(teks)
        pemicu = sorted({p for k in klausa for p in k.pemicu}, key=URUTAN_KATEGORI.index)
        if level_kandidat != "hijau" and self.jangan_turunkan and self.jangan_turunkan.search(normalisasi(teks)):
            return KeputusanAlarm("tetap", level_kandidat, level_kandidat, pemicu, ["putus_asa"])
        alasan_semua = sorted({a for k in klausa for a in k.alasan})
        if level_kandidat == "hijau":
            turun = [a for k in klausa if k.status == "turun" for a in k.alasan]
            nyata = any(k.status in ("nyata", "ragu") for k in klausa)
            return KeputusanAlarm("tidak_ada", "hijau", "hijau", pemicu, [] if nyata else sorted(set(turun)))

        penguat = self._penguat(emosi, topik)
        tubuh = bool(self.bagian_tubuh and self.bagian_tubuh.search(normalisasi(teks)))
        for k in klausa:
            gejala = set(k.pemicu) - self.kat_bukan_gejala
            if penguat and k.status == "ragu" and not (k.diri or tubuh or gejala):
                k.status, k.alasan = "turun", k.alasan + penguat
            elif penguat and k.status == "turun":
                k.alasan = k.alasan + penguat
        alasan_semua = sorted({a for k in klausa for a in k.alasan})

        nyata = [k for k in klausa if k.status == "nyata"]
        if nyata:
            berat = any(k.berat for k in nyata)
            return KeputusanAlarm("langsung" if berat else "tetap", level_kandidat, level_kandidat, pemicu,
                                  sorted({a for k in nyata for a in k.alasan}) or ["gejala_sekarang"])
        ragu = [k for k in klausa if k.status == "ragu"]
        if ragu:
            kat = next((c for c in URUTAN_KATEGORI if any(c in k.pemicu for k in ragu)), "lain")
            return KeputusanAlarm("tanya", "hijau", level_kandidat, pemicu, alasan_semua, kategori_tanya=kat)
        if any(k.status == "turun" for k in klausa):
            return KeputusanAlarm("turun", "hijau", level_kandidat, pemicu, alasan_semua)

        bersih, ada_kiasan = self._buang_kiasan(normalisasi(teks))
        if ada_kiasan and not self._kategori(bersih):
            return KeputusanAlarm("turun", "hijau", level_kandidat, pemicu, ["kiasan"])
        if self.pulih and self._disangkal(bersih):
            return KeputusanAlarm("turun", "hijau", level_kandidat, pemicu, ["penyangkalan"])
        if dari_aturan:
            return KeputusanAlarm("tetap", level_kandidat, level_kandidat, pemicu, ["aturan"])
        konteks = [n for n, p in (("masa_lalu", self.masa_lalu), ("orang_lain", self.orang_lain),
                                  ("cerita", self.cerita)) if p and p.search(bersih)]
        if konteks:
            return KeputusanAlarm("turun", "hijau", level_kandidat, pemicu, konteks + penguat)
        return KeputusanAlarm("tetap", level_kandidat, level_kandidat, pemicu, ["indobert"])

    def jawaban(self, teks: str, kategori: str) -> str | None:
        """Jawaban atas pertanyaan konfirmasi: "ya" / "tidak" / None (bukan jawaban)."""
        t = normalisasi(teks)
        if self.jawab_tidak and self.jawab_tidak.search(t):
            return "tidak"
        if self.jawab_ya and self.jawab_ya.search(t):
            return "ya"
        p = self.pemicu.get(kategori)
        if p and p.search(t) and not self._disangkal(t):
            return "ya"
        return None


def catat(keputusan: KeputusanAlarm) -> None:
    """Log hanya kategori pemicu, keputusan, dan kategori alasan. Tanpa teks dan tanpa id."""
    log_event("konteks_alarm", pemicu=keputusan.pemicu, keputusan=keputusan.keputusan, alasan=keputusan.alasan)


def lebih_tinggi(a: str, b: str) -> bool:
    return URUTAN[a] > URUTAN[b]
