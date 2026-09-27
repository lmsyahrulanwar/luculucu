# 🤖 Robot Binary Option Quotex - MACD (4, 12, 9) Engine

Robot trading binary option otomatis untuk platform **Quotex** (khususnya [market-quotex.pro/en/demo-trade](https://market-quotex.pro/en/demo-trade)) menggunakan **Tampermonkey Userscript** dengan **Floating Glassmorphic HUD** dan **Python WebSocket Bridge Server**.

---

## 📋 Fitur & Aturan Sesuai Permintaan (Rules 1 - 10)

| No | Aturan / Rule | Implementasi |
|---|---|---|
| **1** | Platform & Akun | Berjalan di `https://market-quotex.pro/en/demo-trade` menggunakan **Demo Balance**. |
| **2** | Auto Entry & Browser Extension | Menggunakan userscript Tampermonkey yang melakukan deteksi DOM dan auto-click entry candle 30s. |
| **3** | Floating HUD Tampermonkey | Overlay futuristik menampilkan: **Status Bridge Python, Market Aktif, PnL & Win Rate, Sinyal Entry (BUY/SELL/HOLD), Nilai MACD (Hijau, Merah, Delta, Status Jarak)**, Candle Countdown, dan tombol kontrol. |
| **4** | Parameter Indikator MACD | **Fast EMA = 4, Slow EMA = 12, Signal EMA = 9**. |
| **5** | Timeframe & Durasi | Timeframe chart **30s (TF 30s)** dan waktu kadaluarsa order **30s**. |
| **6** | Money Management (Martingale) | • **Base Stake**: `Rp 15.000`<br>• **K1**: `Rp 35.000`<br>• **K2**: `Rp 77.000`<br>• **K3**: `Rp 165.000`<br>• **K4**: `Rp 350.000`<br>• **K5**: `Rp 747.000`<br>• **K6**: `Rp 1.611.000`<br>• **Win**: Reset kembali ke `Rp 15.000`<br>• **Loss pada K6**: **STOP ENTRY OTOMATIS** (Sistem proteksi saldo aktif). |
| **7** | Logika Sinyal MACD | • **BUY (CALL)**: Garis Hijau (MACD Line) > Garis Merah (Signal Line) & tidak mepet.<br>• **SELL (PUT)**: Garis Hijau (MACD Line) < Garis Merah (Signal Line) & tidak mepet.<br>• **HOLD (MEPET)**: Jarak antara Garis Hijau dan Merah sangat mepet (di bawah threshold) -> Melewati entry candle ini namun **tetap mempertahankan step kompensasi**. |
| **8** | Timing Presisi Entry | Entry ditembakkan tepat pada **detik 1 menuju detik 0** sebelum pembentukan candle baru berikutnya di browser. |
| **9** | Indikator Tunggal | Murni menggunakan indikator **MACD (4, 12, 9)**. |
| **10** | Data Real Market | Mengambil data live tick/candle langsung dari Quotex WebSocket stream & DOM real-time tanpa hardcode backtest. |

---

## 🗂️ Struktur Proyek

```
bot_trading_2/
├── tampermonkey_script.user.js  # Userscript Tampermonkey + Floating HUD + Auto Clicker
├── bridge_server.py             # Python WebSocket Bridge Server (MACD Engine, logger, safety circuit)
├── config.json                  # Konfigurasi parameter trading & threshold
├── test_macd.py                 # Unit test untuk MACD 4-12-9 & sistem Martingale K1-K6
├── simulate_market.py           # Script simulator tick & candle offline
├── start_bot.sh                 # Script one-click start untuk macOS / Linux
├── start_bot.bat                # Script one-click start untuk Windows
└── logs/                        # Folder log hasil trading otomatis (CSV)
```

---

## 🚀 Panduan Instalasi & Penggunaan

### Langkah 1: Install Extension Tampermonkey di Browser
1. Buka browser Anda (Google Chrome, Brave, Edge, atau Firefox).
2. Install extension **Tampermonkey** dari Chrome Web Store: [Tampermonkey Chrome Webstore](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).
3. Pastikan **Developer Mode** pada ekstensi browser aktif (jika diperlukan oleh browser).

### Langkah 2: Pasang Userscript ke Tampermonkey
1. Klik icon **Tampermonkey** di pojok kanan atas browser -> Pilih **Create a new script...** (Buat skrip baru).
2. Hapus seluruh isi default pada editor Tampermonkey.
3. Buka file [`tampermonkey_script.user.js`](file:///Users/user/luculucu/bot_trading_2/tampermonkey_script.user.js) di folder ini, salin (**Copy**) seluruh isinya dan tempel (**Paste**) ke editor Tampermonkey.
4. Klik menu **File** -> **Save** (atau tekan `Ctrl+S` / `Cmd+S`).

### Langkah 3: Jalankan Python Bridge Server
Buka terminal dan jalankan server bridge:
```bash
cd /Users/user/luculucu/bot_trading_2
./start_bot.sh
```
*(Atau gunakan perintah: `python3 bridge_server.py`)*

> **Catatan Redundansi Dual-Engine:**  
> Jika Python Bridge belum dijalankan, userscript Tampermonkey tetap memiliki **Built-in Local MACD Engine** sebagai fallback mandiri di browser sehingga bot tetap dapat menghitung sinyal dengan akurat. Ketika Python Bridge aktif, ekstensi akan otomatis tersambung (`ws://127.0.0.1:8765`).

### Langkah 4: Buka Quotex & Mulai Trading
1. Buka halaman trading: **[https://market-quotex.pro/en/demo-trade](https://market-quotex.pro/en/demo-trade)** (atau domain Quotex aktif lainnya).
2. Pastikan akun dalam mode **Demo Balance**.
3. Atur Timeframe chart pada Quotex ke **30s (S30)**.
4. Panel **Floating HUD** futuristik akan muncul di pojok kanan atas layar browser:
   - Status Bridge: `ONLINE` 🟢
   - Market Aktif: Terdeteksi otomatis (contoh: `EUR/USD (OTC)`)
   - MACD Values: Garis Hijau, Garis Merah, Histogram, dan status Mepet
   - Candle Timer: Menghitung mundur `30s` -> `01s` (Entry Window)
5. Klik tombol hijau **`▶ START AUTO TRADER`** pada Floating HUD.
6. Bot akan otomatis menganalisa per candle 30s dan melakukan open posisi di detik 1 menuju 0 sesuai rule!

---

## 📊 Detail Sistem Martingale & Safety Limit K6

| Level | Nominal Entry (Rp) | Keterangan |
|---|---|---|
| **Base (0)** | **Rp 15.000** | Posisi awal selalu mulai dari sini. Jika Win -> reset ke sini. |
| **K1** | **Rp 35.000** | Kompensasi Level 1 jika Base Loss. |
| **K2** | **Rp 77.000** | Kompensasi Level 2 jika K1 Loss. |
| **K3** | **Rp 165.000** | Kompensasi Level 3 jika K2 Loss. |
| **K4** | **Rp 350.000** | Kompensasi Level 4 jika K3 Loss. |
| **K5** | **Rp 747.000** | Kompensasi Level 5 jika K4 Loss. |
| **K6** | **Rp 1.611.000** | Kompensasi Maksimum (Level 6). |
| **Batas Stop** | **STOP ENTRY** | **Jika K6 mengalami Loss, bot seketika BERHENTI entry otomatis** untuk melindungi sisa saldo. |

---

## 🧪 Pengujian & Verifikasi Kode

Anda dapat menjalankan pengujian otomatis kapan saja:

1. **Unit Test (Perhitungan MACD 4-12-9 & Martingale Step K1-K6)**:
   ```bash
   python3 test_macd.py
   ```
2. **Simulasi Market Feed Real-Time**:
   ```bash
   python3 simulate_market.py
   ```

---

## ⚠️ Catatan Keamanan
- Gunakan selalu akun **Demo** terlebih dahulu untuk memvalidasi ritme candle dan koneksi internet Anda.
- Log riwayat transaksi tersimpan rapi di folder `logs/quotex_trades.csv`.
