"""Emosi pasien ke visual Vine.

Vine tidak meniru emosi pasien. Saat pasien marah, Vine tampil tenang dan menenangkan.
Frontend memakai nilai ini untuk memilih tampilan.
"""

EMOSI_KE_VISUAL = {
    "ceria": "kuning",
    "sedih": "biru",
    "marah": "tenang",
    "netral": "ramah",
}


def visual_untuk(emosi: str) -> str:
    return EMOSI_KE_VISUAL.get(emosi, "ramah")
