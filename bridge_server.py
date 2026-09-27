#!/usr/bin/env python3
"""
=============================================================================
Quotex Binary Option Python Bridge Server (MACD 4-12-9 Strategy)
Timeframe: 30s | Expiration: 30s | Base Stake: Rp 15.000 | Martingale: K1-K6
=============================================================================
"""

import asyncio
import json
import os
import sys
import time
import math
from datetime import datetime
from typing import Dict, List, Optional, Any

try:
    import websockets
except ImportError:
    print("Package 'websockets' belum terinstall. Menginstall otomatis...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
    import websockets

# Configuration constants
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8765

# Martingale compensation progression as per rule 6:
# Level 0 (Normal): 15,000
# K1: 35,000
# K2: 77,000
# K3: 165,000
# K4: 350,000
# K5: 747,000
# K6: 1,611,000
MARTINGALE_STEPS = [
    15000,   # Level 0 (Base)
    35000,   # K1
    77000,   # K2
    165000,  # K3
    350000,  # K4
    747000,  # K5
    1611000  # K6 (Max Limit)
]

MAX_MARTINGALE_LEVEL = 6  # Stop after K6 loss

# MACD parameters (Rule 4)
MACD_FAST = 4
MACD_SLOW = 12
MACD_SIGNAL = 9

# Default mepet threshold (relative or absolute distance between MACD & Signal line)
# When distance is smaller than this threshold, signal is HOLD (Rule 7)
DEFAULT_MEPET_THRESHOLD = 0.00002

class MACDCalculator:
    """Real-time Exponential Moving Average (EMA) and MACD (4, 12, 9) Engine."""
    def __init__(self, fast: int = MACD_FAST, slow: int = MACD_SLOW, signal: int = MACD_SIGNAL):
        self.fast_period = fast
        self.slow_period = slow
        self.signal_period = signal
        self.fast_alpha = 2.0 / (fast + 1.0)
        self.slow_alpha = 2.0 / (slow + 1.0)
        self.signal_alpha = 2.0 / (signal + 1.0)
        
        self.fast_ema: Optional[float] = None
        self.slow_ema: Optional[float] = None
        self.signal_ema: Optional[float] = None
        self.macd_line: float = 0.0
        self.hist: float = 0.0
        self.candle_history: List[Dict[str, Any]] = []

    def reset(self):
        self.fast_ema = None
        self.slow_ema = None
        self.signal_ema = None
        self.macd_line = 0.0
        self.hist = 0.0
        self.candle_history.clear()

    def update_with_price(self, close_price: float) -> Dict[str, Any]:
        """Update EMAs and MACD with a new close price."""
        if self.fast_ema is None:
            self.fast_ema = close_price
        else:
            self.fast_ema = (close_price * self.fast_alpha) + (self.fast_ema * (1.0 - self.fast_alpha))

        if self.slow_ema is None:
            self.slow_ema = close_price
        else:
            self.slow_ema = (close_price * self.slow_alpha) + (self.slow_ema * (1.0 - self.slow_alpha))

        self.macd_line = self.fast_ema - self.slow_ema

        if self.signal_ema is None:
            self.signal_ema = self.macd_line
        else:
            self.signal_ema = (self.macd_line * self.signal_alpha) + (self.signal_ema * (1.0 - self.signal_alpha))

        self.hist = self.macd_line - self.signal_ema

        return {
            "fast_ema": self.fast_ema,
            "slow_ema": self.slow_ema,
            "macd_line": self.macd_line,
            "signal_line": self.signal_ema,
            "hist": self.hist,
            "distance": abs(self.macd_line - self.signal_ema)
        }

    def compute_from_candle_list(self, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Compute full MACD over an array of candles: [{'open', 'high', 'low', 'close', 'time'}]."""
        self.reset()
        result = {}
        for c in candles:
            close_p = float(c.get("close", c.get("c", 0.0)))
            if close_p > 0:
                result = self.update_with_price(close_p)
                self.candle_history.append(c)
        return result


class MartingaleManager:
    """Manages Money Management, Compensation steps (K1 - K6), and stops at K6 loss."""
    def __init__(self, steps: List[int] = MARTINGALE_STEPS, max_level: int = MAX_MARTINGALE_LEVEL):
        self.steps = steps
        self.max_level = max_level
        self.current_level = 0
        self.wins = 0
        self.losses = 0
        self.total_trades = 0
        self.total_pnl = 0.0
        self.is_stopped_due_to_k6_loss = False
        self.last_trade_time = 0

    def get_current_stake(self) -> int:
        if self.is_stopped_due_to_k6_loss:
            return 0
        lvl = min(self.current_level, len(self.steps) - 1)
        return self.steps[lvl]

    def get_level_label(self) -> str:
        if self.current_level == 0:
            return "Base (15k)"
        return f"K{self.current_level} ({self.get_current_stake():,})"

    def record_trade_result(self, result: str, payout_or_loss: float = 0.0) -> Dict[str, Any]:
        """
        result: 'WIN' or 'LOSS'
        """
        self.total_trades += 1
        self.last_trade_time = time.time()
        res_upper = result.upper().strip()

        if res_upper == "WIN":
            self.wins += 1
            self.total_pnl += payout_or_loss
            # Rule 6: ketika win akan reset ke 15000 lagi
            self.current_level = 0
            self.is_stopped_due_to_k6_loss = False
            msg = f"✅ WIN! PnL +Rp {payout_or_loss:,.0f}. Reset level ke Base (15.000)"
        else:
            self.losses += 1
            self.total_pnl -= abs(payout_or_loss) if payout_or_loss != 0 else self.get_current_stake()
            
            # Check if loss happened on K6
            if self.current_level >= self.max_level:
                self.is_stopped_due_to_k6_loss = True
                msg = f"⛔ LOSS PADA K6 ({self.steps[self.max_level]:,})! STOP ENTRY AKTIF (Rule 6). Bot berhenti melakukan order otomatis."
            else:
                self.current_level += 1
                next_stake = self.get_current_stake()
                msg = f"❌ LOSS! Naik ke Kompensasi K{self.current_level} (Rp {next_stake:,})"

        win_rate = (self.wins / self.total_trades * 100.0) if self.total_trades > 0 else 0.0

        return {
            "status": "success",
            "message": msg,
            "result": res_upper,
            "current_level": self.current_level,
            "level_label": self.get_level_label(),
            "next_stake": self.get_current_stake(),
            "is_stopped": self.is_stopped_due_to_k6_loss,
            "wins": self.wins,
            "losses": self.losses,
            "total_trades": self.total_trades,
            "win_rate": round(win_rate, 1),
            "total_pnl": self.total_pnl
        }

    def reset_stats(self):
        self.current_level = 0
        self.wins = 0
        self.losses = 0
        self.total_trades = 0
        self.total_pnl = 0.0
        self.is_stopped_due_to_k6_loss = False


class QuotexBotBridge:
    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
        self.host = host
        self.port = port
        self.macd = MACDCalculator()
        self.martingale = MartingaleManager()
        self.mepet_threshold = DEFAULT_MEPET_THRESHOLD
        self.connected_clients = set()
        self.active_market = "EUR/USD (OTC)"
        self.current_balance = 0.0
        self.is_bot_running = True
        self.last_signal = "HOLD"
        self.last_candle_timestamp = 0
        self.trade_logs: List[Dict[str, Any]] = []

        # Ensure logs dir exists
        os.makedirs("logs", exist_ok=True)
        self.csv_log_path = "logs/quotex_trades.csv"
        if not os.path.exists(self.csv_log_path):
            with open(self.csv_log_path, "w", encoding="utf-8") as f:
                f.write("timestamp,market,signal,stake,level,result,pnl,balance\n")

    def evaluate_signal(self, macd_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluate signal based on user Rule 7:
        - MACD (green line) > Signal (red line) -> BUY
        - MACD (green line) < Signal (red line) -> SELL
        - If MACD and Signal are mepet (distance <= mepet_threshold) -> HOLD
        """
        macd_line = macd_data.get("macd_line", 0.0)
        signal_line = macd_data.get("signal_line", 0.0)
        hist = macd_data.get("hist", 0.0)
        distance = macd_data.get("distance", abs(macd_line - signal_line))

        # Check mepet condition
        is_mepet = distance <= self.mepet_threshold

        if self.martingale.is_stopped_due_to_k6_loss:
            signal = "STOPPED_K6"
            reason = "Stop entry: Mencapai batas Loss K6"
        elif not self.is_bot_running:
            signal = "PAUSED"
            reason = "Bot status: PAUSED"
        elif is_mepet:
            signal = "HOLD"
            reason = f"Garis MACD mepet (Jarak: {distance:.6f} <= Thresh: {self.mepet_threshold:.6f})"
        elif macd_line > signal_line:
            signal = "BUY"
            reason = f"MACD Hijau ({macd_line:.6f}) > Merah ({signal_line:.6f}) -> CALL/BUY"
        elif macd_line < signal_line:
            signal = "SELL"
            reason = f"MACD Hijau ({macd_line:.6f}) < Merah ({signal_line:.6f}) -> PUT/SELL"
        else:
            signal = "HOLD"
            reason = "MACD Netral"

        self.last_signal = signal
        return {
            "signal": signal,
            "reason": reason,
            "is_mepet": is_mepet,
            "macd_line": macd_line,
            "signal_line": signal_line,
            "hist": hist,
            "distance": distance,
            "threshold": self.mepet_threshold,
            "stake": self.martingale.get_current_stake(),
            "level": self.martingale.current_level,
            "level_label": self.martingale.get_level_label(),
            "is_stopped_k6": self.martingale.is_stopped_due_to_k6_loss
        }

    def log_trade_to_csv(self, trade_data: Dict[str, Any]):
        try:
            with open(self.csv_log_path, "a", encoding="utf-8") as f:
                ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(
                    f"{ts},{trade_data.get('market','')},{trade_data.get('signal','')},"
                    f"{trade_data.get('stake',0)},{trade_data.get('level','')},"
                    f"{trade_data.get('result','')},{trade_data.get('pnl',0)},{trade_data.get('balance',0)}\n"
                )
        except Exception as e:
            print(f"[ERROR] Failed writing to CSV: {e}")

    async def broadcast(self, message: Dict[str, Any]):
        if not self.connected_clients:
            return
        payload = json.dumps(message)
        disconnected = set()
        for client in self.connected_clients:
            try:
                await client.send(payload)
            except Exception:
                disconnected.add(client)
        self.connected_clients -= disconnected

    async def handle_client(self, websocket):
        self.connected_clients.add(websocket)
        client_addr = websocket.remote_address
        print(f"\033[92m[BRIDGE] Browser Extension Terhubung dari {client_addr}\033[0m")
        
        # Send initial handshake
        init_payload = {
            "type": "INITIAL_CONFIG",
            "active_market": self.active_market,
            "macd_params": {"fast": MACD_FAST, "slow": MACD_SLOW, "signal": MACD_SIGNAL},
            "martingale_steps": MARTINGALE_STEPS,
            "current_level": self.martingale.current_level,
            "current_stake": self.martingale.get_current_stake(),
            "mepet_threshold": self.mepet_threshold,
            "is_bot_running": self.is_bot_running,
            "is_stopped_k6": self.martingale.is_stopped_due_to_k6_loss,
            "stats": {
                "wins": self.martingale.wins,
                "losses": self.martingale.losses,
                "total_pnl": self.martingale.total_pnl,
                "total_trades": self.martingale.total_trades
            }
        }
        await websocket.send(json.dumps(init_payload))

        try:
            async for raw_msg in websocket:
                try:
                    data = json.loads(raw_msg)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type", "")

                if msg_type == "PING":
                    await websocket.send(json.dumps({"type": "PONG", "timestamp": int(time.time() * 1000)}))

                elif msg_type == "CANDLE_STREAM":
                    # Array of candles received from Quotex DOM/WS
                    candles = data.get("candles", [])
                    if candles:
                        macd_res = self.macd.compute_from_candle_list(candles)
                        sig_eval = self.evaluate_signal(macd_res)
                        
                        response = {
                            "type": "SIGNAL_UPDATE",
                            "market": data.get("market", self.active_market),
                            "macd": macd_res,
                            "evaluation": sig_eval,
                            "timestamp": int(time.time() * 1000)
                        }
                        await websocket.send(json.dumps(response))

                elif msg_type == "TICK_UPDATE":
                    # Single tick price update
                    price = float(data.get("price", 0.0))
                    market = data.get("market", self.active_market)
                    self.active_market = market
                    if price > 0:
                        macd_res = self.macd.update_with_price(price)
                        sig_eval = self.evaluate_signal(macd_res)
                        
                        response = {
                            "type": "SIGNAL_UPDATE",
                            "market": market,
                            "price": price,
                            "macd": macd_res,
                            "evaluation": sig_eval,
                            "timestamp": int(time.time() * 1000)
                        }
                        await websocket.send(json.dumps(response))

                elif msg_type == "TRADE_EXECUTED":
                    # Bot executed an order in browser
                    stake = data.get("stake", self.martingale.get_current_stake())
                    direction = data.get("direction", "UNKNOWN")
                    candle_time = data.get("candle_time", "")
                    print(f"\033[96m[ENTRY] 🚀 Order {direction} | Nominal: Rp {stake:,} | Level: {self.martingale.get_level_label()} | Waktu: {datetime.now().strftime('%H:%M:%S')}\033[0m")

                elif msg_type == "TRADE_RESULT":
                    result = data.get("result", "WIN")
                    payout = float(data.get("payout", 0.0))
                    balance = float(data.get("balance", 0.0))
                    self.current_balance = balance

                    res_data = self.martingale.record_trade_result(result, payout)
                    self.log_trade_to_csv({
                        "market": self.active_market,
                        "signal": self.last_signal,
                        "stake": self.martingale.steps[max(0, self.martingale.current_level - 1 if result == "LOSS" else self.martingale.current_level)],
                        "level": self.martingale.get_level_label(),
                        "result": result,
                        "pnl": payout if result == "WIN" else -self.martingale.get_current_stake(),
                        "balance": balance
                    })

                    print(f"\033[93m[HASIL] {res_data['message']} | Total PnL: Rp {res_data['total_pnl']:,.0f} | WinRate: {res_data['win_rate']}%\033[0m")

                    # Broadcast update to all clients
                    await self.broadcast({
                        "type": "MARTINGALE_UPDATE",
                        "data": res_data
                    })

                elif msg_type == "UPDATE_CONFIG":
                    if "mepet_threshold" in data:
                        self.mepet_threshold = float(data["mepet_threshold"])
                        print(f"[CONFIG] Threshold Mepet diperbarui: {self.mepet_threshold}")
                    if "is_bot_running" in data:
                        self.is_bot_running = bool(data["is_bot_running"])
                        status_str = "BERJALAN" if self.is_bot_running else "DIHENTIKAN"
                        print(f"[STATUS] Bot {status_str}")
                    if "reset_k6" in data and data["reset_k6"]:
                        self.martingale.is_stopped_due_to_k6_loss = False
                        self.martingale.current_level = 0
                        print(f"[RESET] Stop K6 telah di-reset oleh user.")

                    await self.broadcast({
                        "type": "CONFIG_CONFIRM",
                        "mepet_threshold": self.mepet_threshold,
                        "is_bot_running": self.is_bot_running,
                        "current_level": self.martingale.current_level,
                        "is_stopped_k6": self.martingale.is_stopped_due_to_k6_loss
                    })

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.connected_clients.remove(websocket)
            print(f"\033[91m[BRIDGE] Browser Extension Terputus: {client_addr}\033[0m")

    async def start(self):
        self.print_banner()
        async with websockets.serve(self.handle_client, self.host, self.port):
            print(f"\033[92m[*] WebSocket Bridge Server siap di ws://{self.host}:{self.port}\033[0m")
            print(f"[*] Menunggu koneksi dari Tampermonkey userscript di browser...")
            await asyncio.Future()  # run forever

    def print_banner(self):
        banner = f"""
\033[95m================================================================================
       QUOTEX BINARY OPTION TRADING BOT - MACD (4, 12, 9) ENGINE
================================================================================\033[0m
  * Strategy        : MACD (Fast: {MACD_FAST}, Slow: {MACD_SLOW}, Signal: {MACD_SIGNAL})
  * Timeframe       : TF 30s | Expiration: 30s
  * Entry Timing    : Detik 1 menuju 0 sebelum candle baru
  * Base Nominal    : Rp {MARTINGALE_STEPS[0]:,}
  * Martingale Steps: K1={MARTINGALE_STEPS[1]:,} | K2={MARTINGALE_STEPS[2]:,} | K3={MARTINGALE_STEPS[3]:,}
                      K4={MARTINGALE_STEPS[4]:,} | K5={MARTINGALE_STEPS[5]:,} | K6={MARTINGALE_STEPS[6]:,}
  * Max Stop Safety : Berhenti jika K6 Loss (Rule 6)
  * Mepet Filter    : Distance <= {self.mepet_threshold} -> HOLD (Rule 7)
\033[95m================================================================================\033[0m
        """
        print(banner)

def main():
    bridge = QuotexBotBridge()
    try:
        asyncio.run(bridge.start())
    except KeyboardInterrupt:
        print("\n[!] Bridge Server dihentikan oleh user.")

if __name__ == "__main__":
    main()
