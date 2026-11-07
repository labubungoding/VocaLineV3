"""Pencatatan yang aman untuk privasi.

Mencatat kejadian, waktu proses, dan error, tetapi TIDAK PERNAH mencatat isi obrolan pasien.
Field yang namanya mengandung kata terlarang akan diganti "[disembunyikan]".
"""
from __future__ import annotations

import json
import logging
import sys

_FIELD_TERLARANG = ("teks", "text", "balasan", "audio", "transkrip", "riwayat", "history", "prompt")

_logger = logging.getLogger("vine-ml")
if not _logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    _logger.addHandler(handler)
    _logger.setLevel(logging.INFO)


def _aman(fields: dict) -> dict:
    hasil = {}
    for k, v in fields.items():
        if any(t in k.lower() for t in _FIELD_TERLARANG):
            hasil[k] = "[disembunyikan]"
        else:
            hasil[k] = v
    return hasil


def log_event(event: str, **fields) -> None:
    _logger.info("%s %s", event, json.dumps(_aman(fields), ensure_ascii=False, default=str))


def log_warning(event: str, **fields) -> None:
    _logger.warning("%s %s", event, json.dumps(_aman(fields), ensure_ascii=False, default=str))


def log_error(event: str, **fields) -> None:
    _logger.error("%s %s", event, json.dumps(_aman(fields), ensure_ascii=False, default=str))
