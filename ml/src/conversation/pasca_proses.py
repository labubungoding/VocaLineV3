"""Pemeriksaan setiap kalimat balasan LLM sebelum diucapkan.

Dipakai jalur JSON (/process-text, /process-audio) dan jalur streaming (/converse-stream), supaya aturannya sama:
- guardrails saran medis (kalimat diganti kalimat aman, sisa balasan dihentikan)
- info perawat: setelah kalimat alarm diucapkan, kalimat LLM yang menyebut perawat dibuang;
  saat level hijau, klaim "perawat sedang datang/sudah dipanggil" dibuang (menawarkan boleh)
- "Anda" diganti sapaan yang benar (lansia/dewasa), "kamu" untuk remaja
- jumlah kalimat dan kata sesuai persona (config/gaya_bicara.yaml); merah/oranye maks 2 kalimat termasuk alarm
- 1 pertanyaan, dan batas kata per kalimat (lansia 15)
- pembuka kalimat yang baru dipakai tidak boleh dipakai lagi
- ekspresi Vine divalidasi
"""
from __future__ import annotations

import re

from src.conversation import guardrails
from src.conversation.persona import isi_panggilan
from src.conversation.sapaan import balasan_cadangan

EKSPRESI_VALID = ("senang", "antusias", "empati", "tenang", "bercanda", "serius", "netral")

_PERAWAT = r"(perawat|suster|ners)"
_KLAIM_PERAWAT = [
    rf"\b{_PERAWAT}\b(?:\s+\w+){{0,3}}\s+(menuju|datang|ke sini|kesini|dalam perjalanan|segera|dipanggil|diberitahu|diberi tahu|sudah tahu|dikabari|akan membantu|akan datang|sedang)\b",
    rf"\b(sudah|sedang|telah|segera)\s+(saya\s+)?(panggil|panggilkan|hubungi|hubungkan|beritahu|beri tahu|kabari|kabarkan|memanggil|menghubungi|memberi tahu)\w*\s+(ke\s+)?{_PERAWAT}\b",
    rf"\b(saya|aku)\s+(sudah|sedang|telah)\s+(memanggil|menghubungi|mengabari|memberi tahu)\b",
    rf"\b{_PERAWAT}\b\s+(sudah|sedang|telah)\s+(saya\s+|aku\s+)?(panggil|hubungi|kabari|beritahu|beri tahu)\w*",
]
_POLA_KLAIM = [re.compile(p, re.I) for p in _KLAIM_PERAWAT]
_POLA_SEBUT = re.compile(rf"\b{_PERAWAT}\b", re.I)
_POLA_TEMANI = re.compile(r"\b(saya|aku)\s+(akan\s+|bisa\s+|siap\s+|mau\s+)?(temani|menemani|temenin|nemenin)\b", re.I)
_POLA_ANDA = re.compile(r"\b(anda)(nya)?\b", re.I)
_POLA_KAMU = re.compile(r"\b(kamu)(lah)?\b", re.I)
_POLA_MU = re.compile(r"\b(\w{2,}?)mu\b", re.I)
_BUKAN_MU = {"ilmu", "jamu", "tamu", "temu", "bertemu", "ketemu", "menemu", "jemu", "semu", "ramu", "meramu",
             "kamu", "kemu", "umu", "ditemu"}
_POLA_ANGKA = re.compile(r"\b(\d+|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|"
                         r"\w+ belas|\w+ puluh|belasan|puluhan)\b", re.I)
_POLA_KALIMAT = re.compile(r"(?<=[.!?])\s+")


def menebak_ingatan(kalimat: str, teks_pasien: str) -> bool:
    """True jika kalimat menyebut angka yang tidak ada di ucapan pasien (dipakai saat ingatan kosong)."""
    ucapan = teks_pasien.lower()
    return any(m.group(0).lower() not in ucapan for m in _POLA_ANGKA.finditer(kalimat))


def klaim_perawat(kalimat: str) -> bool:
    return any(p.search(kalimat) for p in _POLA_KLAIM)


def sebut_perawat(kalimat: str) -> bool:
    return bool(_POLA_SEBUT.search(kalimat))


def sapaan_hormat(nama: str, persona: str) -> str:
    """Kata ganti untuk pasien: 'kamu' (remaja), 'Bapak'/'Ibu' sesuai nama panggilan, atau nama itu sendiri."""
    if persona == "remaja":
        return "kamu"
    awal = (nama or "").strip().lower().split(" ", 1)[0]
    if awal in ("pak", "bapak", "opa", "kakek", "mbah", "eyang", "om", "mas", "bang", "kak"):
        return "Bapak" if awal in ("pak", "bapak", "opa", "kakek") else nama
    if awal in ("bu", "ibu", "oma", "nenek", "tante", "mbak"):
        return "Ibu" if awal in ("bu", "ibu", "oma", "nenek") else nama
    return nama or "Bapak/Ibu"


def ganti_anda(kalimat: str, persona: str, nama: str) -> str:
    """'Anda' tidak dipakai Vine. Diganti sapaan yang sesuai dengan nama panggilan."""
    pengganti = sapaan_hormat(nama, persona)

    def ganti_kata(teks: str, pola: re.Pattern) -> str:
        def ganti(m: re.Match) -> str:
            kata = pengganti
            if m.start() == 0 or teks[: m.start()].rstrip().endswith((".", "!", "?")):
                kata = kata[:1].upper() + kata[1:]
            return kata + (m.group(2) or "")
        return pola.sub(ganti, teks)

    hasil = ganti_kata(kalimat, _POLA_ANDA)
    if persona != "remaja":
        hasil = ganti_kata(hasil, _POLA_KAMU)
        hasil = _POLA_MU.sub(lambda m: m.group(0) if m.group(0).lower() in _BUKAN_MU
                             else f"{m.group(1)} {pengganti}", hasil)
    if persona != "remaja" and pengganti != "Bapak/Ibu":
        hasil = re.sub(r"Bapak\s*/\s*Ibu", pengganti, hasil, flags=re.I)
    return hasil


def pembuka(kalimat: str) -> str:
    """Pembuka kalimat untuk anti-pengulangan: kata sebelum koma pertama (jika <= 3 kata), atau 2 kata pertama."""
    t = re.sub(r"[^\w\s,]", "", kalimat.lower()).strip()
    if "," in t:
        depan = t.split(",", 1)[0].split()
        if 0 < len(depan) <= 3:
            return " ".join(depan)
    return " ".join(t.replace(",", " ").split()[:2])


def pembuka_basa_basi(kalimat: str) -> bool:
    """True untuk pembuka seperti "Wah," / "Oh begitu," / "Saya mengerti," (maks 3 kata sebelum koma pertama).

    Pembuka seperti ini yang membuat Vine terdengar berulang. Kalimat lain hanya kebetulan sama 2 kata awalnya.
    """
    m = re.match(r"^\s*([^,.!?]{1,30}),", kalimat)
    return bool(m and len(m.group(1).split()) <= 3)


def buang_pembuka(kalimat: str) -> str | None:
    """'Wah, seru ya.' → 'Seru ya.' Mengembalikan None jika pembuka tidak dipisah koma (tidak bisa dibuang rapi)."""
    m = re.match(r"^\s*([^,.!?]{1,30}),\s*(.+)$", kalimat)
    if not m or len(m.group(1).split()) > 3 or len(m.group(2).split()) < 2:
        return None
    sisa = m.group(2).strip()
    return sisa[:1].upper() + sisa[1:]


_SAMBUNG = {"dan", "tapi", "tetapi", "karena", "sambil", "supaya", "agar", "lalu", "kemudian", "sehingga",
            "jadi", "atau", "padahal", "walaupun", "meskipun", "soalnya", "biar"}
_GANTUNG = _SAMBUNG | {"yang", "di", "ke", "dari", "dengan", "untuk", "pada", "oleh", "si", "para", "sang"}


def potong_panjang(kalimat: str, maks_kata: int) -> str:
    """Kalimat lebih dari `maks_kata` kata dipotong sampai muat (lansia 15).

    Urutan: di koma terakhir (jika sisa >= 5 kata), di kata sambung terakhir (jika sisa >= 4 kata),
    lalu dipotong paksa di batas kata tanpa kata gantung di ujung.
    """
    kata = kalimat.split()
    if len(kata) <= maks_kata:
        return kalimat
    tanya = kalimat.rstrip().endswith("?")

    def tutup(potong: str) -> str:
        potong = potong.rstrip(" ,;:-")
        return potong + ("?" if tanya and "?" not in potong else ".")

    depan = kata[:maks_kata]
    teks_depan = " ".join(depan)
    if "," in teks_depan:
        potong = teks_depan.rsplit(",", 1)[0].strip()
        if len(potong.split()) >= 5:
            return tutup(potong)
    for i in range(len(depan) - 1, 3, -1):
        if depan[i].lower().strip(",.") in _SAMBUNG:
            return tutup(" ".join(depan[:i]))
    while len(depan) > 1 and depan[-1].lower().strip(",.") in _GANTUNG:
        depan.pop()
    return tutup(" ".join(depan))


def ekspresi_valid(nilai: str | None, level: str, emosi: str, bawaan: dict | None = None) -> str:
    """Ekspresi dari LLM setelah aturan: merah → tenang, pasien marah → tidak boleh bercanda, nilai aneh → netral."""
    nilai = (nilai or "").strip().lower()
    if nilai not in EKSPRESI_VALID:
        nilai = (bawaan or {}).get(emosi, "netral") if not nilai else "netral"
    if level == "merah":
        return "tenang"
    if level == "oranye" and nilai in ("bercanda", "antusias"):
        return "tenang"
    if emosi == "marah" and nilai == "bercanda":
        return "tenang"
    return nilai


class PenyaringKalimat:
    """Memeriksa kalimat LLM satu per satu. `olah()` mengembalikan kalimat yang boleh diucapkan, atau None.

    `selesai` menjadi True jika sisa balasan tidak perlu dibaca lagi (saran medis terdeteksi,
    jumlah kalimat sudah maksimal, atau jumlah kata sudah penuh), supaya stream LLM bisa dihentikan lebih awal.

    Batas kalimat: `maks_kalimat` saat hijau, `maks_kalimat_alarm` (termasuk kalimat alarm) setelah alarm
    diucapkan atau level naik. `maks_kata_total` (hanya hijau): kalimat LLM yang membuat total kata
    melewati batas dibuang dan balasan berhenti di situ. Kalimat LLM pertama selalu boleh (sudah dipotong per kalimat).
    Balasan ditutup pertanyaan: setelah ada `min_kalimat` kalimat, kalimat bertanda tanya mengakhiri balasan.
    """

    def __init__(self, persona: str, nama: str, level_fn, pembuka_terakhir: list[str] | None = None,
                 maks_kalimat: int = 2, maks_kata: int = 18, template_terakhir: dict | None = None,
                 teks_pasien: str = "", ada_ingatan: bool = True, balasan_sebelumnya: list[str] | None = None,
                 maks_kalimat_alarm: int = 2, maks_kata_total: int | None = None, min_kalimat: int = 2):
        self.persona, self.nama = persona, nama
        self.balasan_sebelumnya = [" ".join(b.lower().split()) for b in (balasan_sebelumnya or [])]
        self.cek_tebakan = not ada_ingatan and "ingat" in teks_pasien.lower()
        self.teks_pasien = teks_pasien
        self.level_fn = level_fn
        self.pembuka_terakhir = [p for p in (pembuka_terakhir or []) if p]
        self.maks_kalimat, self.maks_kata = maks_kalimat, maks_kata
        self.maks_kalimat_alarm, self.maks_kata_total = maks_kalimat_alarm, maks_kata_total
        self.alarm = False
        self.kata = 0
        self.penuh = False
        self.min_kalimat = min_kalimat
        self.template_terakhir = template_terakhir if template_terakhir is not None else {}
        self.jumlah = 0
        self.dari_llm = 0
        self.info_perawat = False
        self.nama_terpakai = False
        self.ada_pertanyaan = False
        self.diblokir = False
        self.dibuang: list[str] = []
        self.tertahan: str | None = None

    def mode_alarm(self) -> bool:
        """Merah/oranye: balasan tetap singkat."""
        return self.alarm or self.level_fn() != "hijau"

    @property
    def batas_kalimat(self) -> int:
        return self.maks_kalimat_alarm if self.mode_alarm() else self.maks_kalimat

    @property
    def selesai(self) -> bool:
        return self.diblokir or self.penuh or self.jumlah >= self.batas_kalimat

    def catat_alarm(self, kalimat: str = "") -> None:
        """Dipanggil setelah kalimat alarm dikirim."""
        self.alarm = True
        self.jumlah += 1
        self.kata += len(kalimat.split())
        self.info_perawat = True
        self.catat_nama(kalimat)

    def olah(self, kalimat: str) -> str | None:
        if self.selesai:
            return None
        k = ganti_anda(isi_panggilan(kalimat, self.nama).strip(), self.persona, self.nama)
        k = self._satu_kali_nama(k)
        if not k:
            return None
        if not guardrails.aman(k):
            self.diblokir = True
            self.dibuang.append("saran_medis")
            return self._pengganti_medis()
        if self.cek_tebakan and menebak_ingatan(k, self.teks_pasien):
            self.dibuang.append("tebakan_ingatan")
            if "tebakan_ingatan" in self.dibuang[:-1]:
                return None
            aku = "Aku" if self.persona == "remaja" else "Saya"
            if self.ada_pertanyaan:
                return self._terima(f"{aku} belum tahu soal itu.", dari_llm=True)
            lanjut = "ceritain lagi dong?" if self.persona == "remaja" else "boleh diceritakan lagi?"
            return self._terima(f"{aku} belum tahu, {lanjut}", dari_llm=True)
        if sebut_perawat(k):
            if self.info_perawat:
                self.dibuang.append("perawat_diulang")
                return None
            if klaim_perawat(k) and self.level_fn() == "hijau":
                self.dibuang.append("klaim_perawat_saat_hijau")
                return None
        if _POLA_TEMANI.search(k):
            self.dibuang.append("saya_temani")
            return None
        k = self._satu_pertanyaan(k)
        if not k:
            return None
        k = potong_panjang(k, self.maks_kata)
        if self.dari_llm == 0 and pembuka(k) in self.pembuka_terakhir:
            ganti = buang_pembuka(k)
            if ganti is None or pembuka(ganti) in self.pembuka_terakhir:
                self.dibuang.append("pembuka_berulang")
                if self.tertahan is None and not pembuka_basa_basi(k):
                    self.tertahan = k
                return None
            k = ganti
        if self.maks_kata_total and self.dari_llm and not self.mode_alarm()                 and self.kata + len(k.split()) > self.maks_kata_total:
            self.dibuang.append("melebihi_kata")
            self.penuh = True
            return None
        return self._terima(k, dari_llm=True)

    def ambil_tertahan(self) -> str | None:
        """Kalimat yang ditahan karena pembukanya sama, jika tidak ada kalimat LLM lain yang lolos.

        Tetap tidak dipakai jika pembukanya sama dengan balasan TEPAT sebelumnya (tidak boleh 2x berturut-turut),
        atau kalimatnya sudah pernah diucapkan di riwayat. Dalam hal itu pemanggil memakai template.
        """
        if self.dari_llm or self.tertahan is None or self.selesai:
            return None
        k, self.tertahan = self.tertahan, None
        bersih = " ".join(k.lower().split())
        if (self.pembuka_terakhir and pembuka(k) == self.pembuka_terakhir[-1]) or \
                any(bersih in b for b in self.balasan_sebelumnya):
            return None
        self.dibuang.remove("pembuka_berulang")
        return self._terima(k, dari_llm=True)

    def _satu_pertanyaan(self, k: str) -> str:
        """Paling banyak 1 pertanyaan per balasan. Potongan bisa berisi beberapa kalimat pendek yang digabung
        pemecah kalimat ("Siapa namanya? Berapa umurnya?"), jadi diperiksa per kalimat di dalamnya."""
        keluar, tanya = [], self.ada_pertanyaan
        for bagian in _POLA_KALIMAT.split(k):
            if "?" in bagian:
                if tanya:
                    self.dibuang.append("pertanyaan_kedua")
                    continue
                tanya = True
            keluar.append(bagian)
        return " ".join(keluar).strip()

    def _pengganti_medis(self) -> str | None:
        """Template aman pengganti saran medis, tetap mengikuti aturan yang sama dengan kalimat LLM:
        sisa jatah kalimat, 1 pertanyaan, nama sekali, dan perawat tidak disebut lagi setelah alarm."""
        kunci = "alarm_lanjutan" if self.info_perawat else "medis"
        teks = balasan_cadangan(kunci, self.persona, self.nama, self.template_terakhir)
        keluar: list[str] = []
        tanya = self.ada_pertanyaan
        for k in _POLA_KALIMAT.split(teks.strip()):
            k = self._satu_kali_nama(k.strip())
            if not k or self.jumlah + len(keluar) >= self.batas_kalimat:
                continue
            if (self.info_perawat and sebut_perawat(k)) or ("?" in k and tanya):
                continue
            tanya = tanya or "?" in k
            keluar.append(k)
        if not keluar:
            return None
        self.jumlah += len(keluar) - 1
        return self._terima(" ".join(keluar), dari_llm=True)

    def _satu_kali_nama(self, k: str) -> str:
        """Nama panggilan sebagai sapaan (", Pak Yusuf") paling banyak sekali per balasan.

        Kalimat alarm sudah memakai nama, jadi setelah itu sapaan nama berikutnya dibuang.
        """
        nama = (self.nama or "").strip()
        if not nama:
            return k
        pola = re.compile(rf",\s*{re.escape(nama)}(?=\s*[,.!?])", re.I)
        if self.nama_terpakai:
            k = pola.sub("", k)
        else:
            cocok = list(pola.finditer(k))
            for m in reversed(cocok[1:]):
                k = k[: m.start()] + k[m.end():]
        if nama.lower() in k.lower():
            self.nama_terpakai = True
        return k

    def catat_nama(self, kalimat: str) -> None:
        if self.nama and self.nama.lower() in kalimat.lower():
            self.nama_terpakai = True

    def _terima(self, k: str, dari_llm: bool) -> str:
        self.jumlah += 1
        self.kata += len(k.split())
        self.dari_llm += int(dari_llm)
        if "?" in k and self.jumlah >= self.min_kalimat:
            self.penuh = True
        self.ada_pertanyaan = self.ada_pertanyaan or "?" in k
        self.info_perawat = self.info_perawat or klaim_perawat(k)
        return k
