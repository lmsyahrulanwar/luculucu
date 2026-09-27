#!/usr/bin/env bash
# ==============================================================================
# Script Startup Quotex Python Bridge & Auto-Trader (Mac/Linux)
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=========================================================="
echo "    QUOTEX BOT TRADING MACD (4,12,9) - BRIDGE SERVER      "
echo "=========================================================="

# Check Python3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 tidak ditemukan. Harap install Python 3.9+ terlebih dahulu."
    exit 1
fi

# Check websockets package
python3 -c "import websockets" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "[INFO] Menginstall dependensi websockets..."
    python3 -m pip install websockets
fi

# Run bridge server
echo "[INFO] Menjalankan bridge server di ws://localhost:8765..."
python3 bridge_server.py
