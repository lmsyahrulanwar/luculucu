#!/usr/bin/env python3
"""
Simulate Quotex WebSocket market feed and test bridge integration.
Useful for offline testing and verifying MACD signals before live trading.
"""
import asyncio
import json
import random
import time
import websockets

BRIDGE_WS_URL = "ws://127.0.0.1:8765"

async def simulate_market_feed():
    print(f"[*] Menghubungkan simulator ke Python Bridge di {BRIDGE_WS_URL}...")
    try:
        async with websockets.connect(BRIDGE_WS_URL) as ws:
            print("[+] Terhubung! Mengirim simulasi tick & candle Quotex TF 30s...")
            
            # Start baseline price for EUR/USD (OTC)
            current_price = 1.08500
            trend = 0.00005  # upward bias to test BUY signal
            
            for step in range(30):
                # Fluctuate price
                noise = (random.random() - 0.48) * 0.00008
                current_price += trend + noise
                
                payload = {
                    "type": "TICK_UPDATE",
                    "market": "EUR/USD (OTC)",
                    "price": round(current_price, 6),
                    "time": int(time.time() * 1000)
                }
                
                await ws.send(json.dumps(payload))
                
                # Receive evaluation response
                try:
                    response_raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    resp = json.loads(response_raw)
                    if resp.get("type") == "SIGNAL_UPDATE":
                        eval_data = resp.get("evaluation", {})
                        macd = resp.get("macd", {})
                        print(f"[{step+1:02d}] Harga: {current_price:.5f} | MACD: {macd.get('macd_line', 0):+.6f} | Signal: {macd.get('signal_line', 0):+.6f} | Evaluasi: {eval_data.get('signal')} ({eval_data.get('reason')})")
                except asyncio.TimeoutError:
                    pass

                # Change trend mid-way to test SELL signal
                if step == 15:
                    trend = -0.00007
                    print("\n[!] Mengubah tren market menjadi DOWNWARD...\n")

                await asyncio.sleep(0.5)

            print("\n[+] Simulasi selesai dengan sukses!")
    except Exception as e:
        print(f"[-] Gagal menghubungkan ke bridge: {e}")

if __name__ == "__main__":
    asyncio.run(simulate_market_feed())
