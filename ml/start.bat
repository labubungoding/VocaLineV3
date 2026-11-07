@echo off

cd /d "%~dp0"
set TUNNEL=%1
if "%TUNNEL%"=="" set TUNNEL=vine-ml

if not exist ".venv\Scripts\python.exe" (
  echo [GAGAL] Folder .venv belum ada. Jalankan dulu: python -m venv .venv lalu pip install -r requirements.txt
  exit /b 1
)
if not exist ".env" (
  echo [GAGAL] File .env belum ada. Salin dari .env.example lalu isi ML_API_KEY.
  exit /b 1
)
findstr /r /c:"^ML_API_KEY=..*" .env >nul || (
  echo [GAGAL] ML_API_KEY di .env masih kosong.
  exit /b 1
)

echo Menyalakan ml-service di http://127.0.0.1:8000 ...
start "Vine ml-service" cmd /k ".venv\Scripts\python.exe -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000"

if "%TUNNEL%"=="--lokal" (
  echo Mode lokal: tunnel tidak dinyalakan. Buka http://127.0.0.1:8000/docs
  exit /b 0
)

where cloudflared >nul 2>nul || (
  echo [GAGAL] cloudflared belum terpasang. Unduh dari situs Cloudflare, atau jalankan dengan: start.bat --lokal
  exit /b 1
)

echo Menunggu server siap ...
:tunggu
timeout /t 3 /nobreak >nul
curl -s http://127.0.0.1:8000/health >nul 2>nul || goto tunggu

echo Server siap. Menyalakan tunnel "%TUNNEL%" ...
cloudflared tunnel run --url http://127.0.0.1:8000 %TUNNEL%
