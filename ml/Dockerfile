FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/home/app/.cache/huggingface

RUN apt-get update \
 && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 app

WORKDIR /app
COPY requirements.txt constraints-docker.txt ./

ARG INSTALL_PIPER=0
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchaudio \
 && grep -viE '^piper-tts' requirements.txt > /tmp/requirements-docker.txt \
 && pip install -r /tmp/requirements-docker.txt -c constraints-docker.txt \
 && if [ "$INSTALL_PIPER" = "1" ]; then pip install piper-tts -c constraints-docker.txt; fi

COPY --chown=app:app . .
RUN mkdir -p /home/app/.cache && chown -R app:app /home/app/.cache /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["python", "-m", "uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
