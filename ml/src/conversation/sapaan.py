"""Kalimat yang tidak butuh Gemini: sapaan pertama, pengingat jadwal, dan balasan cadangan.

Semua kalimat mengikuti persona dan memakai nama panggilan pasien.
Memakai template supaya cepat, konsisten, dan tidak menghabiskan kuota Gemini.
"""
from __future__ import annotations

import random

from src.conversation.persona import isi_panggilan

SAPAAN = {
    "remaja": [
        "Hai {panggilan}! Aku Vine, teman ngobrol kamu selama di sini. Kalau bosen atau butuh bantuan, panggil aku aja ya.",
        "Halo {panggilan}, kenalin aku Vine. Mau ngobrol apa aja boleh, dan kalau butuh perawat, bilang aja ke aku.",
    ],
    "dewasa": [
        "Selamat datang, {panggilan}. Saya Vine, teman ngobrol selama dirawat di sini. Kalau butuh bantuan perawat, cukup sampaikan ke saya.",
        "Halo, {panggilan}. Perkenalkan, saya Vine. Saya siap menemani ngobrol, dan bisa memanggilkan perawat kapan pun dibutuhkan.",
    ],
    "lansia": [
        "Selamat datang, {panggilan}. Saya Vine. Saya teman ngobrol di sini. Kalau butuh perawat, bilang saja ke saya.",
        "Halo, {panggilan}. Nama saya Vine. Kalau mau ngobrol atau butuh bantuan, panggil saya saja.",
    ],
}

PENGINGAT = {
    "makan_pagi": {
        "remaja": "{panggilan}, udah waktunya sarapan nih. Makan dulu ya biar ada tenaga.",
        "dewasa": "{panggilan}, sudah waktunya sarapan. Selamat makan.",
        "lansia": "{panggilan}, sudah waktunya sarapan. Pelan pelan saja makannya.",
    },
    "makan_siang": {
        "remaja": "{panggilan}, waktunya makan siang. Jangan dilewatin ya.",
        "dewasa": "{panggilan}, sudah waktunya makan siang. Selamat makan.",
        "lansia": "{panggilan}, sudah waktunya makan siang. Pelan pelan saja makannya.",
    },
    "makan_malam": {
        "remaja": "{panggilan}, waktunya makan malam nih. Habis itu bisa santai lagi.",
        "dewasa": "{panggilan}, sudah waktunya makan malam. Selamat makan.",
        "lansia": "{panggilan}, sudah waktunya makan malam. Pelan pelan saja makannya.",
    },
    "kunjungan_dokter": {
        "remaja": "{panggilan}, sebentar lagi dokter datang buat periksa ya.",
        "dewasa": "{panggilan}, sebentar lagi dokter akan datang untuk pemeriksaan.",
        "lansia": "{panggilan}, sebentar lagi dokter datang. Nanti diperiksa ya.",
    },
}

CADANGAN = {
    "alarm": {
        "remaja": ["Perawat lagi menuju ke sini ya, {panggilan}."],
        "dewasa": ["Perawat sedang menuju ke sini, {panggilan}."],
        "lansia": ["Perawat sedang menuju ke sini, {panggilan}."],
    },
    "alarm_lanjutan": {
        "remaja": [
            "Tarik napas pelan-pelan ya, aku di sini.",
            "Tenang ya, bentar lagi dibantu.",
            "Coba rileks dulu, tarik napas pelan.",
            "Aku di sini kok, tahan sebentar ya.",
        ],
        "dewasa": [
            "Tarik napas pelan-pelan ya, {panggilan}.",
            "Tenang ya, sebentar lagi dibantu.",
            "Coba rileks dulu, tarik napas perlahan.",
            "Saya di sini, tunggu sebentar ya.",
        ],
        "lansia": [
            "Tarik napas pelan-pelan ya, {panggilan}.",
            "Tenang ya, sebentar lagi dibantu.",
            "Pelan-pelan saja ya, saya di sini.",
            "Tunggu sebentar ya, {panggilan}.",
        ],
    },
    "medis": {
        "remaja": [
            "Itu mending ditanyain langsung ke perawat ya. Mau aku panggilin perawat?",
            "Soal obat, aku nggak boleh jawab, tanya perawat aja ya. Mau aku panggilin?",
            "Yang paling tahu itu perawat. Mau aku panggilin perawat sekarang?",
            "Biar aman, tanya perawat dulu ya. Mau aku panggilin?",
        ],
        "dewasa": [
            "Itu sebaiknya ditanyakan langsung ke perawat, {panggilan}. Mau saya panggilkan perawat?",
            "Untuk urusan obat, perawat yang paling tepat menjawab. Mau saya panggilkan?",
            "Supaya aman, tanyakan ke perawat dulu ya, {panggilan}. Mau saya panggilkan?",
            "Soal itu perawat yang bisa menjelaskan. Mau saya panggilkan perawat sekarang?",
        ],
        "lansia": [
            "Itu ditanyakan ke perawat saja ya, {panggilan}. Mau saya panggilkan?",
            "Soal obat, perawat yang lebih tahu. Mau saya panggilkan perawat?",
            "Supaya aman, tanya perawat dulu ya, {panggilan}. Mau saya panggilkan?",
            "Perawat bisa menjelaskan itu, {panggilan}. Mau saya panggilkan?",
        ],
    },
    "ceria": {
        "remaja": [
            "Wah, ikut seneng dengernya! Ceritain lagi dong.",
            "Asik banget! Terus gimana?",
            "Keren! Aku pengen denger lebih banyak.",
            "Mantap! Gimana ceritanya?",
        ],
        "dewasa": [
            "Senang sekali mendengarnya, {panggilan}. Ceritakan lagi.",
            "Wah, kabar baik. Lalu bagaimana, {panggilan}?",
            "Ikut senang, {panggilan}. Bagaimana kelanjutannya?",
            "Syukurlah, {panggilan}. Mau cerita lebih banyak?",
        ],
        "lansia": [
            "Wah, senang sekali, {panggilan}. Lalu bagaimana?",
            "Syukurlah, {panggilan}. Ceritakan lagi ya.",
            "Bagus sekali, {panggilan}. Bagaimana kelanjutannya?",
            "Ikut senang, {panggilan}. Mau cerita lagi?",
        ],
    },
    "sedih": {
        "remaja": [
            "Aku dengerin kok. Mau cerita lebih banyak?",
            "Pasti berat ya. Aku di sini kok.",
            "Wajar banget ngerasa gitu. Mau cerita?",
            "Aku ngerti kok. Pelan-pelan aja ceritanya.",
        ],
        "dewasa": [
            "Saya dengar, {panggilan}, pasti berat rasanya. Mau cerita lebih banyak?",
            "Wajar merasa begitu, {panggilan}. Saya dengarkan.",
            "Itu pasti tidak mudah, {panggilan}. Mau cerita?",
            "Saya mengerti, {panggilan}. Pelan-pelan saja ceritanya.",
        ],
        "lansia": [
            "Saya dengar, {panggilan}. Mau cerita pelan pelan?",
            "Iya, {panggilan}, saya mengerti. Saya dengarkan ya.",
            "Wajar merasa begitu, {panggilan}. Mau cerita sedikit?",
            "Pasti berat ya, {panggilan}. Saya di sini mendengarkan.",
        ],
    },
    "marah": {
        "remaja": [
            "Wajar kok kamu kesel. Aku dengerin, ceritain aja.",
            "Iya, nyebelin ya. Ceritain aja ke aku.",
            "Aku paham kok keselnya. Kenapa sih?",
            "Oke, aku dengerin. Keluarin aja unek-uneknya.",
        ],
        "dewasa": [
            "Saya mengerti kesalnya, {panggilan}. Saya dengarkan, ceritakan saja.",
            "Wajar merasa kesal, {panggilan}. Apa yang paling mengganggu?",
            "Iya, itu menjengkelkan, {panggilan}. Saya dengarkan.",
            "Saya paham, {panggilan}. Ceritakan saja pelan-pelan.",
        ],
        "lansia": [
            "Iya, {panggilan}, saya dengarkan. Ceritakan saja ya.",
            "Wajar kesal, {panggilan}. Apa yang paling mengganggu?",
            "Saya paham, {panggilan}. Ceritakan pelan-pelan ya.",
            "Iya, sabar ya, {panggilan}. Saya dengarkan.",
        ],
    },
    "belum_ingat": {
        "remaja": [
            "Maaf, aku belum tahu, {panggilan}. Ceritain lagi dong?",
            "Hmm, aku belum dengar soal itu. Boleh ceritain lagi?",
            "Aku belum tahu nih. Gimana ceritanya?",
            "Wah, aku belum dengar. Ceritain lagi ya?",
        ],
        "dewasa": [
            "Maaf, saya belum tahu, {panggilan}. Boleh diceritakan lagi?",
            "Saya belum mendengar soal itu, {panggilan}. Mau cerita lagi?",
            "Maaf, saya belum tahu. Bagaimana ceritanya, {panggilan}?",
            "Saya belum tahu soal itu, {panggilan}. Boleh diceritakan?",
        ],
        "lansia": [
            "Maaf, saya belum tahu, {panggilan}. Boleh diceritakan lagi?",
            "Saya belum dengar ceritanya, {panggilan}. Mau cerita lagi?",
            "Maaf, saya belum tahu. Bagaimana ceritanya, {panggilan}?",
            "Saya belum tahu, {panggilan}. Boleh diceritakan pelan-pelan?",
        ],
    },
    "netral": {
        "remaja": [
            "Oh gitu. Terus gimana?",
            "Hmm, menarik. Ceritain lagi dong.",
            "Oke. Terus kamu ngapain?",
            "Oh, gitu ya. Lanjut dong ceritanya.",
        ],
        "dewasa": [
            "Oh begitu, {panggilan}. Lalu bagaimana?",
            "Begitu ya, {panggilan}. Ceritakan lagi.",
            "Menarik, {panggilan}. Bagaimana kelanjutannya?",
            "Baik, {panggilan}. Ada lagi yang mau diceritakan?",
        ],
        "lansia": [
            "Oh begitu, {panggilan}. Lalu bagaimana?",
            "Begitu ya, {panggilan}. Ceritakan lagi.",
            "Menarik sekali, {panggilan}. Lalu?",
            "Iya, {panggilan}. Bagaimana kelanjutannya?",
        ],
    },
}

JENIS_PENGINGAT = tuple(PENGINGAT)


def sapaan_pertama(persona: str, nama_panggilan: str | None, seed: int | None = None) -> str:
    pilihan = SAPAAN.get(persona, SAPAAN["dewasa"])
    return isi_panggilan(random.Random(seed).choice(pilihan), nama_panggilan)


def pengingat(jenis: str, persona: str, nama_panggilan: str | None, pesan_tambahan: str = "") -> str:
    if jenis in PENGINGAT:
        teks = PENGINGAT[jenis].get(persona, PENGINGAT[jenis]["dewasa"])
    else:
        teks = "{panggilan}, ada pengingat dari perawat."
    teks = isi_panggilan(teks, nama_panggilan)
    if pesan_tambahan:
        teks = f"{teks} {pesan_tambahan.strip()}"
    return teks


def balasan_cadangan(kunci: str, persona: str, nama_panggilan: str | None, terakhir: dict | None = None) -> str:
    """Kalimat template. Dipilih acak; jika `terakhir` (dict per kasur) diberikan, tidak mengulang pilihan terakhir."""
    grup = CADANGAN.get(kunci, CADANGAN["netral"])
    pilihan = grup.get(persona, grup["dewasa"])
    kunci_ingat = f"{kunci}:{persona}"
    if terakhir is not None and len(pilihan) > 1:
        pilihan = [p for p in pilihan if p != terakhir.get(kunci_ingat)] or pilihan
    teks = random.choice(pilihan)
    if terakhir is not None:
        terakhir[kunci_ingat] = teks
    return isi_panggilan(teks, nama_panggilan)
