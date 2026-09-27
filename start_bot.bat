@echo off
title Quotex MACD (4,12,9) Bridge Server
cd /d "%~dp0"

echo ==========================================================
echo     QUOTEX BOT TRADING MACD (4,12,9) - BRIDGE SERVER
echo ==========================================================

python -c "import websockets" >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Menginstall modul websockets...
    python -m pip install websockets
)

echo [INFO] Menjalankan bridge server di ws://localhost:8765...
python bridge_server.py
pause
