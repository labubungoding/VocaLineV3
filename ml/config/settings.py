"""Pengaturan umum ml-service.

Nilai rahasia dan lokasi model dibaca dari file .env.
Angka yang sering diatur (ambang, jumlah tanya ulang, kata darurat) ada di thresholds.yaml.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    ml_api_key: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b,qwen/qwen3.8-27b"
    llm_provider: str = "groq"
    stt_provider: str = "groq"
    whisper_model: str = "small"
    intent_model_dir: str = "models/indobert-intent"
    emotion_model_dir: str = "models/indobert-emotion"
    baseline_intent_path: str = "models/baseline-intent.joblib"
    baseline_emotion_path: str = "models/baseline-emotion.joblib"
    vine_demo_page: bool = True
    mode_dev: bool = False
    tts_provider: str = "browser"
    piper_model_path: str = "models/tts/id_ID-news_tts-medium.onnx"

    def path(self, relative: str) -> Path:
        p = Path(relative)
        return p if p.is_absolute() else ROOT / p


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_thresholds() -> dict:
    with open(ROOT / "config" / "thresholds.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)
