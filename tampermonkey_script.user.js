// ==UserScript==
// @name         Quotex MACD (4,12,9) Auto-Trader & Python Bridge Bot
// @namespace    https://market-quotex.pro/
// @version      5.5.8
// @description  Full Synchronized Quotex MACD (4,12,9) Auto-Trader: Dedicated Investment Input Targeter, Completed Trades Sidebar Watcher, Instant Martingale K1-K6.
// @author       AI Antigravity
// @match        https://market-quotex.pro/*
// @match        https://*.market-quotex.pro/*
// @match        https://qxbroker.com/*
// @match        https://*.qxbroker.com/*
// @match        https://quotex.io/*
// @match        https://*.quotex.io/*
// @match        https://quotex.com/*
// @match        https://*.quotex.com/*
// @icon         https://market-quotex.pro/favicon.ico
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    console.log("%c[QUOTEX-BOT] Initializing MACD (4,12,9) Bot v3.6 with Dedicated Investment Targeter & Instant K1-K6...", "color: #00ffcc; font-weight: bold; font-size: 14px;");

    const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ==========================================
    // 1. CONFIGURATION & MARTINGALE PROGRESSION
    // ==========================================
    const CONFIG = {
        wsBridgeUrl: "ws://127.0.0.1:8765",
        timeframeSec: 30,       // 30s candles (Rule 5)
        entryLeadMs: 1000,      // Entry 1 second before new candle (Rule 8)
        
        // MACD Parameters (Rule 4)
        macdFast: 4,
        macdSlow: 12,
        macdSignal: 9,

        // Martingale Table as per Rule 6
        // Base: 15,000 | K1: 35,000 | K2: 77,000 | K3: 165,000 | K4: 350,000 | K5: 747,000 | K6: 1,611,000
        martingaleSteps: [15000, 35000, 77000, 165000, 350000, 747000, 1611000],
        maxLevel: 6,            // Stop if K6 loss (Rule 6)

        // Toleransi Jarak Mepet (Hold filter saat kedua garis rapat/sejajar, ~0.3 pip)
        defaultMepetThreshold: 0.000025
    };

    // Global State
    const STATE = {
        isBotActive: false,
        bridgeStatus: "CONNECTING", // CONNECTED, LOCAL_MODE, OFFLINE
        activeMarket: "AUD/CHF (OTC)",
        activePayout: "94%",
        currentPrice: 0.0,
        currentLevel: 0,
        currentStake: CONFIG.martingaleSteps[0],
        isStoppedK6: false,
        
        // PnL & Stats
        startBalance: 0,
        currentBalance: 0,
        totalPnL: 0,
        wins: 0,
        losses: 0,
        totalTrades: 0,
        
        // MACD State
        macdLine: 0.0,
        signalLine: 0.0,
        hist: 0.0,
        distance: 0.0,
        isMepet: false,
        mepetThreshold: CONFIG.defaultMepetThreshold,
        currentSignal: "HOLD", // BUY, SELL, HOLD, STOPPED_K6
        signalReason: "Sinkronisasi Chart...",
        
        // Timing & Trades
        lastEntryCandleTimestamp: 0,
        activeTrade: null,
        candleCountdown: 30,

        // Visual Canvas Line Tips
        visualGreenTip: null,
        visualRedTip: null,

        soundEnabled: true
    };

    // ==========================================
    // 2. LIVE PRICE INTERCEPTOR (Seamless Market Sync & OHLC Parser)
    // ==========================================
    let lastRecordedPrice = 0;
    let lastTickTime = 0;

    try {
        const origFillText = win.CanvasRenderingContext2D.prototype.fillText;
        win.CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
            try {
                if (typeof text === 'string') {
                    const clean = text.trim().replace(/,/g, '');

                    // 1. Direct OHLC Close Parser (e.g. "Close: 104.9028")
                    if (text.includes('Close:') || text.includes('Close :')) {
                        const m = text.match(/Close\s*:\s*([\d.]+)/i);
                        if (m) {
                            const p = parseFloat(m[1]);
                            if (p > 0.0001 && p < 1000000) {
                                lastRecordedPrice = p;
                                lastTickTime = Date.now();
                                CandleStore.addLiveTick(p, lastTickTime);
                            }
                        }
                    }

                    // 2. Continuous Price Axis Numbers (Retina & Standard)
                    if (/^\d{1,6}\.\d{3,6}$/.test(clean)) {
                        const p = parseFloat(clean);
                        if (p > 0.0001 && p < 1000000) {
                            const now = Date.now();
                            // If price jumped by > 10%, it's a new market!
                            if (lastRecordedPrice === 0 || Math.abs(p - lastRecordedPrice) / lastRecordedPrice > 0.10) {
                                lastRecordedPrice = p;
                                CandleStore.candles = [];
                                CandleStore.tickStream = [];
                                CandleStore.currentCandle = null;
                            }

                            if (p !== lastRecordedPrice || (now - lastTickTime > 150)) {
                                lastRecordedPrice = p;
                                lastTickTime = now;
                                CandleStore.addLiveTick(p, now);
                            }
                        }
                    }
                }
            } catch (err) {}
            return origFillText.apply(this, [text, x, y, ...args]);
        };

        // 3. Direct Visual MACD Line Tip Tracker from Canvas Strokes
        let lastLineToX = 0, lastLineToY = 0;
        const origLineTo = win.CanvasRenderingContext2D.prototype.lineTo;
        win.CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
            lastLineToX = x;
            lastLineToY = y;
            return origLineTo.apply(this, [x, y]);
        };

        const origStroke = win.CanvasRenderingContext2D.prototype.stroke;
        win.CanvasRenderingContext2D.prototype.stroke = function (...args) {
            try {
                const style = String(this.strokeStyle || '').toLowerCase();
                const now = Date.now();

                // Any Green / Teal / Cyan MACD line stroke
                if (style.includes('38, 166') || style.includes('26, 188') || style.includes('0, 255') || style.includes('0, 230') || style.includes('0, 200') || style.includes('0, 150') || style.includes('#00') || style.includes('#26') || style.includes('green') || style.includes('teal')) {
                    if (lastLineToX > 0 && lastLineToY > 0) {
                        STATE.visualGreenTip = { x: lastLineToX, y: lastLineToY, time: now };
                    }
                }
                // Any Red / Orange / Pink Signal line stroke
                else if (style.includes('239, 83') || style.includes('231, 76') || style.includes('255, 82') || style.includes('255, 0') || style.includes('244, 67') || style.includes('#ef') || style.includes('#ff') || style.includes('red') || style.includes('orange')) {
                    if (lastLineToX > 0 && lastLineToY > 0) {
                        STATE.visualRedTip = { x: lastLineToX, y: lastLineToY, time: now };
                    }
                }
            } catch (e) {}
            return origStroke.apply(this, args);
        };
    } catch (e) {
        console.warn("[QUOTEX-BOT] Canvas hook fallback:", e);
    }

    // ==========================================
    // 3. CANDLE STORE & REAL-TIME MACD ENGINE
    // ==========================================
    const CandleStore = {
        candles: [],
        tickStream: [],
        currentCandle: null,
        maxCandles: 300,

        addLiveTick(price, timestamp = Date.now()) {
            if (!price || isNaN(price) || price <= 0) return;
            STATE.currentPrice = price;
            this.tickStream.push({ time: timestamp, price: price });
            if (this.tickStream.length > 500) this.tickStream.shift();

            const candleInterval = CONFIG.timeframeSec * 1000;
            const bucketTime = Math.floor(timestamp / candleInterval) * candleInterval;

            if (!this.currentCandle || this.currentCandle.time !== bucketTime) {
                if (this.currentCandle) {
                    this.candles.push({ ...this.currentCandle });
                    if (this.candles.length > this.maxCandles) this.candles.shift();
                }
                this.currentCandle = {
                    time: bucketTime,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: 1
                };
            } else {
                this.currentCandle.high = Math.max(this.currentCandle.high, price);
                this.currentCandle.low = Math.min(this.currentCandle.low, price);
                this.currentCandle.close = price;
                this.currentCandle.volume += 1;
            }

            Engine.evaluate();
        },

        seedHistory(candleArray) {
            if (!Array.isArray(candleArray) || candleArray.length === 0) return;
            const parsed = [];
            for (const c of candleArray) {
                if (Array.isArray(c)) {
                    parsed.push({
                        time: Number(c[0] || 0),
                        open: parseFloat(c[1]),
                        high: parseFloat(c[2]),
                        low: parseFloat(c[3]),
                        close: parseFloat(c[4]),
                        volume: c[5] || 1
                    });
                } else if (typeof c === 'object' && c !== null) {
                    parsed.push({
                        time: Number(c.time || c.t || c.timestamp || 0),
                        open: parseFloat(c.open || c.o || c.close || c.c || 0),
                        high: parseFloat(c.high || c.h || c.close || c.c || 0),
                        low: parseFloat(c.low || c.l || c.close || c.c || 0),
                        close: parseFloat(c.close || c.c || c.price || c.p || 0),
                        volume: c.volume || c.v || 1
                    });
                }
            }
            
            const valid = parsed.filter(c => !isNaN(c.close) && c.close > 0);
            if (valid.length > 0) {
                // Strict chronological sorting ascending: oldest first, newest last
                valid.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
                this.candles = valid.slice(-this.maxCandles);
                Engine.evaluate();
            }
        }
    };

    const Engine = {
        fastAlpha: 2 / (CONFIG.macdFast + 1),     // 0.4
        slowAlpha: 2 / (CONFIG.macdSlow + 1),     // 0.1538
        signalAlpha: 2 / (CONFIG.macdSignal + 1), // 0.2

        getAdaptiveMepetThreshold(marketName, price) {
            const m = (marketName || '').toUpperCase();
            const p = price > 0 ? price : 1.0;

            // 1. JPY Pairs (USD/JPY, EUR/JPY, GBP/JPY, AUD/JPY) -> Pip scale 0.01
            if (m.includes('JPY') || (p >= 50 && p < 300 && !m.includes('INR') && !m.includes('BRL'))) {
                return 0.0025;
            }

            // 2. High-value Crypto & Gold (BTC, ETH, XAU/USD, Gold)
            if (m.includes('BTC') || m.includes('ETH') || m.includes('XAU') || m.includes('GOLD') || p >= 500) {
                return p * 0.000030;
            }

            // 3. Exotic Currencies (USD/INR, USD/BRL, USD/PKR, USD/EGP, USD/IDR)
            if (m.includes('INR') || m.includes('BRL') || m.includes('PKR') || m.includes('EGP') || m.includes('IDR')) {
                return 0.0020;
            }

            // 4. Standard Forex 4-5 Decimals (EUR/USD, GBP/AUD, AUD/CHF, GBP/USD, EUR/GBP)
            return 0.000025;
        },

        evaluate() {
            // Priority 1: Fetch real candles from React Fiber whenever needed
            const rCandles = QuotexScraper.findCandlesFromReact();
            if (rCandles && rCandles.length >= 5) {
                if (CandleStore.candles.length < rCandles.length || CandleStore.candles.length <= 2) {
                    CandleStore.seedHistory(rCandles);
                }
            }

            // Canonical 30s Candle MACD (4, 12, 9) Calculation
            const candles = [...CandleStore.candles];
            if (CandleStore.currentCandle) candles.push(CandleStore.currentCandle);
            candles.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

            const curP = STATE.currentPrice;
            // Filter out old candles from other currency pairs (e.g. 0.85 EURGBP vs 104.9 USDINR)
            let validCandles = candles.filter(c => !isNaN(c.close) && c.close > 0 && (curP <= 0 || Math.abs(c.close - curP) / curP < 0.25));
            let closes = validCandles.map(c => c.close);

            // If not enough 30s candles, sample from tickStream into 30s intervals
            if (closes.length < 2 && CandleStore.tickStream.length >= 2) {
                const intervalMs = CONFIG.timeframeSec * 1000;
                const bucketMap = new Map();
                for (const t of CandleStore.tickStream) {
                    if (curP <= 0 || Math.abs(t.price - curP) / curP < 0.25) {
                        const b = Math.floor(t.time / intervalMs) * intervalMs;
                        bucketMap.set(b, t.price);
                    }
                }
                const sortedBuckets = Array.from(bucketMap.keys()).sort((a, b) => a - b);
                closes = sortedBuckets.map(b => bucketMap.get(b));
            }

            if (closes.length >= 2) {
                let fastEMA = closes[0];
                let slowEMA = closes[0];
                const macdSeries = [];

                for (let i = 0; i < closes.length; i++) {
                    const p = closes[i];
                    fastEMA = (p * this.fastAlpha) + (fastEMA * (1.0 - this.fastAlpha));
                    slowEMA = (p * this.slowAlpha) + (slowEMA * (1.0 - this.slowAlpha));
                    macdSeries.push(fastEMA - slowEMA);
                }

                let signalEMA = macdSeries[0];
                for (let i = 0; i < macdSeries.length; i++) {
                    const m = macdSeries[i];
                    signalEMA = (m * this.signalAlpha) + (signalEMA * (1.0 - this.signalAlpha));
                }

                let mLine = macdSeries[macdSeries.length - 1];
                let sigEMA = signalEMA;

                const hist = mLine - sigEMA;
                const distance = Math.abs(mLine - sigEMA);
                const effectiveThreshold = this.getAdaptiveMepetThreshold(STATE.activeMarket, curP);
                const isMepet = distance <= effectiveThreshold;

                STATE.macdLine = mLine;
                STATE.signalLine = sigEMA;
                STATE.hist = hist;
                STATE.distance = distance;
                STATE.isMepet = isMepet;
                STATE.mepetThreshold = effectiveThreshold;

                this.applySignal(mLine, sigEMA, isMepet, effectiveThreshold);
            }

            UI.updateHUD();
        },

        applySignal(macd, signal, isMepet, effectiveThreshold = STATE.mepetThreshold) {
            if (STATE.isStoppedK6) {
                STATE.currentSignal = "STOPPED_K6";
                STATE.signalReason = "STOP: Batas K6 Loss Tercapai!";
                return;
            }
            if (!STATE.isBotActive) {
                STATE.currentSignal = "HOLD";
                STATE.signalReason = "Standby (Klik Start Bot)";
                return;
            }

            // Priority 1: Direct Visual Line Tip comparison from Canvas Strokes
            const now = Date.now();
            if (STATE.visualGreenTip && STATE.visualRedTip && (now - STATE.visualGreenTip.time < 2500) && (now - STATE.visualRedTip.time < 2500)) {
                // In canvas screen coordinates: smaller Y = higher position on screen
                const pixelDiff = STATE.visualRedTip.y - STATE.visualGreenTip.y; // Positive if Green is higher than Red
                const isVisuallyMepet = Math.abs(pixelDiff) < 1.5;

                if (isVisuallyMepet) {
                    STATE.currentSignal = "HOLD";
                    STATE.signalReason = `⏸️ Garis Mepet (Visual Gap: ${Math.abs(pixelDiff).toFixed(1)}px)`;
                    return;
                } else if (pixelDiff > 0) {
                    STATE.currentSignal = "BUY";
                    STATE.signalReason = `🟢 Ujung Hijau > Merah -> CALL/BUY (+${pixelDiff.toFixed(1)}px)`;
                    return;
                } else {
                    STATE.currentSignal = "SELL";
                    STATE.signalReason = `🔴 Ujung Hijau < Merah -> PUT/SELL (${pixelDiff.toFixed(1)}px)`;
                    return;
                }
            }

            // Priority 2: Mathematical EMA MACD Engine
            if (isMepet) {
                STATE.currentSignal = "HOLD";
                STATE.signalReason = `⏸️ Garis Mepet (Jarak: ${STATE.distance.toFixed(6)} <= ${effectiveThreshold.toFixed(6)})`;
            } else if (macd > signal) {
                STATE.currentSignal = "BUY";
                STATE.signalReason = `🟢 Hijau > Merah -> CALL/BUY`;
            } else if (macd < signal) {
                STATE.currentSignal = "SELL";
                STATE.signalReason = `🔴 Hijau < Merah -> PUT/SELL`;
            } else {
                STATE.currentSignal = "HOLD";
                STATE.signalReason = "MACD Netral";
            }
        }
    };

    // ==========================================
    // 4. QUOTEX INTERNAL SCRAPER (React Fiber, Visual Indicator)
    // ==========================================
    const QuotexScraper = {
        findCandlesFromReact() {
            try {
                const searchRoots = [
                    document.querySelector('.chart-wrapper canvas'),
                    document.querySelector('canvas'),
                    document.querySelector('.chart-wrapper'),
                    document.querySelector('.page-trade'),
                    document.querySelector('#root'),
                    document.body
                ].filter(Boolean);

                for (const root of searchRoots) {
                    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$') || k.startsWith('__reactInternalInstance$'));
                    if (!fiberKey) continue;

                    const queue = [root[fiberKey]];
                    let visited = 0;
                    while (queue.length > 0 && visited < 2500) {
                        const node = queue.shift();
                        visited++;
                        if (!node) continue;

                        const candidates = [node.memoizedProps, node.memoizedState, node.stateNode];
                        for (const obj of candidates) {
                            if (obj && typeof obj === 'object') {
                                if (Array.isArray(obj.candles) && obj.candles.length >= 5) return obj.candles;
                                if (Array.isArray(obj.history) && obj.history.length >= 5) return obj.history;
                                if (Array.isArray(obj.quotes) && obj.quotes.length >= 5) return obj.quotes;
                                if (Array.isArray(obj.bars) && obj.bars.length >= 5) return obj.bars;
                                if (Array.isArray(obj.data) && obj.data.length >= 5 && (obj.data[0]?.close || Array.isArray(obj.data[0]))) return obj.data;
                            }
                        }

                        if (node.child) queue.push(node.child);
                        if (node.sibling) queue.push(node.sibling);
                    }
                }
            } catch (e) {}
            return null;
        },

        // Reads the exact visual Green vs Red line from Quotex's MACD sub-chart
        readVisualMACD() {
            try {
                // Check SVG paths in chart container
                const svgPaths = document.querySelectorAll('.chart-wrapper svg path, svg.chart path, path[stroke]');
                let greenPoints = null;
                let redPoints = null;

                for (const p of svgPaths) {
                    const stroke = (p.getAttribute('stroke') || p.style.stroke || '').toLowerCase();
                    const d = p.getAttribute('d');
                    if (d && d.length > 10) {
                        if (stroke.includes('0, 255') || stroke.includes('26, 188, 156') || stroke.includes('#00') || stroke.includes('green')) {
                            const pts = d.match(/[\d.]+/g);
                            if (pts && pts.length >= 4) greenPoints = pts;
                        } else if (stroke.includes('255, 0') || stroke.includes('231, 76, 60') || stroke.includes('#ff') || stroke.includes('red')) {
                            const pts = d.match(/[\d.]+/g);
                            if (pts && pts.length >= 4) redPoints = pts;
                        }
                    }
                }

                if (greenPoints && redPoints) {
                    // Last Y coordinate of each line
                    const lastGreenY = parseFloat(greenPoints[greenPoints.length - 1]);
                    const lastRedY = parseFloat(redPoints[redPoints.length - 1]);

                    // In SVG Y-axis, smaller Y = higher on screen!
                    const isGreenAbove = lastGreenY < lastRedY;
                    const diffY = Math.abs(lastGreenY - lastRedY);
                    const isMepet = diffY < 1.5;

                    const mVal = isGreenAbove ? 0.000120 : -0.000120;
                    const sVal = 0.000000;

                    return {
                        macd: mVal,
                        signal: sVal,
                        hist: mVal - sVal,
                        isMepet: isMepet
                    };
                }
            } catch (e) {}
            return null;
        }
    };

    // ==========================================
    // 5. SOUND SYNTHESIZER
    // ==========================================
    const Sound = {
        ctx: null,
        init() {
            if (!this.ctx) {
                const AudioCtx = win.AudioContext || win.webkitAudioContext;
                if (AudioCtx) this.ctx = new AudioCtx();
            }
        },
        play(type) {
            if (!STATE.soundEnabled) return;
            try {
                this.init();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume();

                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain);
                gain.connect(this.ctx.destination);

                if (type === 'entry') {
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(587.33, now);
                    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
                    osc.start(now);
                    osc.stop(now + 0.2);
                } else if (type === 'win') {
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(523.25, now);
                    osc.frequency.setValueAtTime(659.25, now + 0.1);
                    osc.frequency.setValueAtTime(783.99, now + 0.2);
                    osc.frequency.setValueAtTime(1046.50, now + 0.3);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
                    osc.start(now);
                    osc.stop(now + 0.5);
                } else if (type === 'loss') {
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(349.23, now);
                    osc.frequency.linearRampToValueAtTime(220.00, now + 0.3);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.linearRampToValueAtTime(0.01, now + 0.35);
                    osc.start(now);
                    osc.stop(now + 0.35);
                } else if (type === 'k6_alarm') {
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(880, now);
                    gain.gain.setValueAtTime(0.25, now);
                    gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
                    osc.start(now);
                    osc.stop(now + 0.5);
                }
            } catch (e) {}
        }
    };

    // ==========================================
    // 6. SOCKET.IO WEBSOCKET LISTENER & BRIDGE
    // ==========================================
    function parseWs(rawData) {
        if (!rawData) return;
        let str = null;
        if (typeof rawData === 'string') str = rawData;
        else if (rawData instanceof ArrayBuffer) str = new TextDecoder().decode(rawData);

        if (str) {
            const bracketIdx = str.indexOf('[');
            if (bracketIdx !== -1) {
                try {
                    const parsed = JSON.parse(str.slice(bracketIdx));
                    if (Array.isArray(parsed) && parsed.length >= 2) {
                        const ev = parsed[0];
                        const body = parsed[1];
                        if (ev === 'tick' || ev === 'chart-live' || ev === 'depth' || ev === 'live' || ev === 'quotes') {
                            if (body && typeof body === 'object') {
                                const price = parseFloat(body.price || body.c || body.close || body.rate || (Array.isArray(body) ? body[1] : 0));
                                const sym = body.symbol || body.asset || body.pair || body.s;
                                
                                if (sym && price > 0) {
                                    const symFormatted = sym.replace(/_/g, '/').toUpperCase();
                                    const curBase = (STATE.activeMarket || '').replace(/\s*\(OTC\)/i, '').replace(/_/g, '/').trim().toUpperCase();
                                    const incBase = symFormatted.replace(/\s*\(OTC\)/i, '').trim().toUpperCase();

                                    // ONLY ingest ticks that match the active market!
                                    if (incBase === curBase || symFormatted === STATE.activeMarket) {
                                        CandleStore.addLiveTick(price);
                                        Bridge.send({ type: "TICK_UPDATE", market: STATE.activeMarket, price: price, time: Date.now() });
                                    }
                                }
                            }
                        } else if (ev === 'history' || ev === 'candles' || ev === 'history/candles' || ev === 'chart/history') {
                            const cData = Array.isArray(body) ? body : (body.data || body.candles || body.history || []);
                            if (Array.isArray(cData) && cData.length > 0) CandleStore.seedHistory(cData);
                        }
                    }
                } catch (e) {}
            }
        }
    }

    try {
        const OrigWS = win.WebSocket;
        win.WebSocket = function (...args) {
            const ws = new OrigWS(...args);
            ws.addEventListener('message', function (event) {
                if (event.data instanceof Blob) event.data.text().then(t => parseWs(t)).catch(() => {});
                else parseWs(event.data);
            });
            return ws;
        };
        win.WebSocket.prototype = OrigWS.prototype;
    } catch (e) {}

    // Python Bridge Client
    const Bridge = {
        socket: null,
        reconnectTimer: null,

        connect() {
            if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
                return;
            }

            try {
                this.socket = new WebSocket(CONFIG.wsBridgeUrl);

                this.socket.onopen = () => {
                    STATE.bridgeStatus = "CONNECTED";
                    UI.updateHUD();
                    this.send({ type: "CLIENT_HELLO", market: STATE.activeMarket, balance: STATE.currentBalance });
                };

                this.socket.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (!data) return;

                        if (data.type === "INITIAL_CONFIG") {
                            if (data.current_level !== undefined) {
                                STATE.currentLevel = data.current_level;
                                STATE.currentStake = CONFIG.martingaleSteps[STATE.currentLevel] || CONFIG.martingaleSteps[0];
                            }
                            if (data.is_stopped_k6 !== undefined) STATE.isStoppedK6 = data.is_stopped_k6;
                            UI.updateHUD();
                        } else if (data.type === "MARTINGALE_UPDATE") {
                            if (data.data) {
                                STATE.currentLevel = data.data.current_level;
                                STATE.currentStake = data.data.next_stake;
                                STATE.isStoppedK6 = data.data.is_stopped;
                                STATE.wins = data.data.wins;
                                STATE.losses = data.data.losses;
                                STATE.totalTrades = data.data.total_trades;
                                STATE.totalPnL = data.data.total_pnl;
                                if (STATE.isStoppedK6) Sound.play('k6_alarm');
                            }
                            UI.updateHUD();
                        }
                    } catch (e) {}
                };

                this.socket.onclose = () => {
                    STATE.bridgeStatus = "LOCAL_MODE";
                    UI.updateHUD();
                    this.scheduleReconnect();
                };

                this.socket.onerror = () => {
                    STATE.bridgeStatus = "LOCAL_MODE";
                    UI.updateHUD();
                };
            } catch (err) {
                STATE.bridgeStatus = "LOCAL_MODE";
                this.scheduleReconnect();
            }
        },

        scheduleReconnect() {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.connect(), 4000);
        },

        send(payload) {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify(payload));
            }
        }
    };

    // ==========================================
    // 7. QUOTEX DOM INTERACTOR (Market, Payout, History Sync)
    // ==========================================
    let hasSyncedHistoryOnLoad = false;

    const QuotexDOM = {
        getBuyButton() {
            const specific = ['.section-deal .btn-green', '.deal-form .btn-green', 'button.section-deal__button-call', 'button.btn-call', 'button.call-btn'];
            for (const s of specific) {
                const el = document.querySelector(s);
                if (el && el.offsetParent !== null) return el;
            }
            const all = document.querySelectorAll('button, a.button');
            for (const btn of all) {
                const txt = btn.innerText.trim().toUpperCase();
                if (txt.includes('DEPOSIT') || txt.includes('WITHDRAWAL')) continue;
                if ((txt === 'UP' || txt === 'UP ↑' || txt.startsWith('UP') || txt === 'CALL' || txt === 'NAIK') && btn.offsetParent !== null) {
                    return btn;
                }
            }
            return null;
        },

        getSellButton() {
            const specific = ['.section-deal .btn-red', '.deal-form .btn-red', 'button.section-deal__button-put', 'button.btn-put', 'button.put-btn'];
            for (const s of specific) {
                const el = document.querySelector(s);
                if (el && el.offsetParent !== null) return el;
            }
            const all = document.querySelectorAll('button, a.button');
            for (const btn of all) {
                const txt = btn.innerText.trim().toUpperCase();
                if (txt.includes('DEPOSIT') || txt.includes('WITHDRAWAL')) continue;
                if ((txt === 'DOWN' || txt === 'DOWN ↓' || txt.startsWith('DOWN') || txt === 'PUT' || txt === 'TURUN') && btn.offsetParent !== null) {
                    return btn;
                }
            }
            return null;
        },

        getAmountInput() {
            // Check specific investment inputs first
            const specificSelectors = [
                'input[name="amount"]',
                '.section-deal__investment input',
                '[data-test="investment-input"]',
                '.investment-input input'
            ];
            for (const s of specificSelectors) {
                const el = document.querySelector(s);
                if (el && el.offsetParent !== null) return el;
            }

            // Search inputs inside .section-deal / .deal-form that are NOT time inputs
            const dealInputs = document.querySelectorAll('.section-deal input, .deal-form input, [class*="deal-form"] input');
            for (const inp of dealInputs) {
                if (inp && inp.offsetParent !== null) {
                    const val = (inp.value || '').trim();
                    // Time inputs contain ":" (e.g. 00:00:30) or name="time" -> skip!
                    if (val.includes(':') || inp.name === 'time') continue;

                    // Investment input has currency, numbers, or parent label Investment
                    const parentTxt = (inp.closest('.input-control, [class*="form-row"], div')?.innerText || '').toLowerCase();
                    if (parentTxt.includes('invest') || parentTxt.includes('amount') || parentTxt.includes('jumlah') || /[\d,.]+/.test(val)) {
                        return inp;
                    }
                }
            }

            // Fallback: Return the second input in deal form if 2 inputs exist (1st is Time, 2nd is Investment)
            if (dealInputs.length >= 2) return dealInputs[1];
            if (dealInputs.length === 1) return dealInputs[0];

            return null;
        },

        readBalance() {
            const selectors = [
                '.header-balance', '.balance-info', '.usermenu__info-balance',
                '.balance-block__value', '[data-test="balance"]', '.usermenu__balance-value',
                '[class*="usermenu"] [class*="balance"]', '[class*="header"] [class*="balance"]',
                '.usermenu', '[class*="usermenu"]'
            ];
            for (const s of selectors) {
                const el = document.querySelector(s);
                if (el && el.innerText) {
                    const clean = el.innerText.replace(/[^0-9.]/g, '');
                    const val = parseFloat(clean);
                    if (!isNaN(val) && val > 0) return val;
                }
            }
            // Fallback: search any element in top header with currency symbol
            const headerEls = document.querySelectorAll('header *[class*="balance"], header *[class*="user"], [class*="header"] div');
            for (const el of headerEls) {
                const txt = el.innerText || '';
                if ((txt.includes('Rp') || txt.includes('$') || txt.includes('€')) && (txt.includes('DEMO') || txt.includes('LIVE') || /[\d,.]+/.test(txt))) {
                    const clean = txt.replace(/[^0-9.]/g, '');
                    const val = parseFloat(clean);
                    if (!isNaN(val) && val > 100) return val;
                }
            }
            return STATE.currentBalance;
        },

        readLiveChartPrice() {
            // Priority 1: Check Close: text on chart
            const allTxt = document.body.innerText || '';
            const closeMatch = allTxt.match(/Close\s*:\s*([\d.]+)/i);
            if (closeMatch) {
                const p = parseFloat(closeMatch[1]);
                if (p > 0.0001 && p < 1000000) return p;
            }

            // Priority 2: Check chart price elements
            const els = document.querySelectorAll('.chart-wrapper div, [class*="chart"] div, [class*="price"], [class*="badge"], [class*="value"]');
            for (const el of els) {
                if (el && el.offsetParent !== null && !el.closest('#quotex-mini-hud') && !el.closest('.section-deal')) {
                    const txt = (el.innerText || '').trim().replace(/,/g, '');
                    if (/^\d{1,6}\.\d{2,6}$/.test(txt)) {
                        const p = parseFloat(txt);
                        if (p > 0.0001 && p < 1000000) return p;
                    }
                }
            }
            return 0;
        },

        readMarketAndPayout() {
            let foundMarket = null;
            let foundPayout = null;

            // Priority 1: Check the active tab at top left (above chart)
            const topTabSelectors = [
                '.header-sub__item',
                '.header-sub__tabs',
                '[class*="asset-select"]',
                '.asset-select',
                '[class*="tabs-list"] > *',
                '.tab-item.active',
                '.tab-item--active',
                '.tab-item',
                '.header-sub'
            ];

            for (const sel of topTabSelectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null && !el.closest('#quotex-mini-hud')) {
                    const txt = el.innerText || '';
                    const m = txt.match(/([A-Z]{3}[\/_][A-Z]{3}(?:\s*\(OTC\))?)/i);
                    if (m && !txt.includes('DEMO ACCOUNT') && !txt.includes('LIVE ACCOUNT')) {
                        foundMarket = m[1].replace(/_/g, '/').toUpperCase();
                        const pMatch = txt.match(/(\d{1,3})%/);
                        if (pMatch && parseInt(pMatch[1]) >= 10 && parseInt(pMatch[1]) <= 100) {
                            foundPayout = `${pMatch[1]}%`;
                        }
                        if (foundMarket && foundPayout) break;
                    }
                }
            }

            // Priority 2: Check the active deal panel header at top right (above Investment)
            if (!foundMarket || !foundPayout) {
                const dealHeaderSelectors = [
                    '.section-deal__header',
                    '.section-deal__asset-name',
                    '.section-deal__asset',
                    '[class*="deal-form__header"]',
                    '[class*="section-deal"] [class*="asset"]'
                ];
                for (const sel of dealHeaderSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null && !el.closest('#quotex-mini-hud')) {
                        const txt = el.innerText || '';
                        if (!foundMarket) {
                            const m = txt.match(/([A-Z]{3}[\/_][A-Z]{3}(?:\s*\(OTC\))?)/i);
                            if (m) foundMarket = m[1].replace(/_/g, '/').toUpperCase();
                        }
                        if (!foundPayout) {
                            const pMatch = txt.match(/(\d{1,3})%/);
                            if (pMatch && parseInt(pMatch[1]) >= 10 && parseInt(pMatch[1]) <= 100) {
                                foundPayout = `${pMatch[1]}%`;
                            }
                        }
                        if (foundMarket && foundPayout) break;
                    }
                }
            }

            // Priority 3: Search relative to PAIR INFORMATION button
            if (!foundMarket) {
                const pairInfoBtn = Array.from(document.querySelectorAll('button, a, div')).find(e => (e.innerText || '').includes('PAIR INFORMATION'));
                if (pairInfoBtn && pairInfoBtn.parentElement) {
                    const parent = pairInfoBtn.parentElement.parentElement || pairInfoBtn.parentElement;
                    const txt = parent.innerText || '';
                    const m = txt.match(/([A-Z]{3}[\/_][A-Z]{3}(?:\s*\(OTC\))?)/i);
                    if (m) {
                        foundMarket = m[1].replace(/_/g, '/').toUpperCase();
                        const pMatch = txt.match(/(\d{1,3})%/);
                        if (pMatch) foundPayout = `${pMatch[1]}%`;
                    }
                }
            }

            // Priority 4: Fallback for payout from deal form
            if (!foundPayout) {
                const dealEl = document.querySelector('.section-deal, [class*="deal-form"], [class*="section-deal__payout"]');
                if (dealEl && dealEl.innerText) {
                    const pctMatch = dealEl.innerText.match(/(\d{1,3})%/);
                    if (pctMatch && parseInt(pctMatch[1]) >= 10 && parseInt(pctMatch[1]) <= 100) {
                        foundPayout = `${pctMatch[1]}%`;
                    }
                }
            }

            // Update STATE and handle market switch
            if (foundMarket) {
                if (STATE.activeMarket !== foundMarket) {
                    console.log(`%c[QUOTEX-BOT] Active market changed: ${STATE.activeMarket} -> ${foundMarket}`, "color: #ff9900; font-weight: bold;");
                    STATE.activeMarket = foundMarket;
                    STATE.currentPrice = 0;
                    lastRecordedPrice = 0;
                    CandleStore.candles = [];
                    CandleStore.tickStream = [];
                    CandleStore.currentCandle = null;
                }
            }

            if (foundPayout) {
                STATE.activePayout = foundPayout;
            }
        },

        lastTopTradeEl: null,
        lastCompletedCount: -1,

        // Real-time Trade Result Watcher from right sidebar (Instant Martingale Progression)
        syncLiveTradesHistory() {
            try {
                // 1. Direct class selectors
                let tradeCards = Array.from(document.querySelectorAll(
                    '.trades-item, [class*="trade-item"], [class*="trades-list"] > div, .history-item, [class*="history__item"], [class*="deals-list"] > div, .deal-item, [class*="sidebar"] [class*="item"], [class*="tab-trades"] > div, [class*="trades"] > div'
                ));

                // 2. Fallback: Search all containers on right side that have currency pair and amount
                if (!tradeCards || tradeCards.length === 0) {
                    const allDivs = document.querySelectorAll('[class*="trades"], [class*="deals"], [class*="sidebar"] div, [class*="history"] div');
                    const found = [];
                    for (const d of allDivs) {
                        const txt = (d.innerText || '').trim();
                        // Look for cards containing e.g. "GBP/AUD", "15,000 Rp" or "00:00:30"
                        if ((txt.includes('OTC') || /[A-Z]{3}[\/_][A-Z]{3}/.test(txt)) && (txt.includes('Rp') || txt.includes('$') || txt.includes('00:00:30'))) {
                            // Ensure it's a leaf/card container (not the entire list wrapper)
                            if (d.children.length <= 6 && d.innerText.length < 120) {
                                found.push(d);
                            }
                        }
                    }
                    tradeCards = found;
                }

                if (!tradeCards || tradeCards.length === 0) return;

                const completedCards = [];
                for (const card of tradeCards) {
                    const txt = (card.innerText || '').trim();
                    if (!txt) continue;
                    // Skip active/running trade with countdown (e.g. 00:06, 00:25) or "Sell now"
                    if (txt.includes('Sell now') || /\b00:0[1-9]\b|\b00:[12][0-9]\b/.test(txt)) {
                        continue;
                    }
                    // Valid completed trade card (has 00:00:30 or completed amount)
                    if (txt.includes('00:00:30') || txt.includes('0 Rp') || txt.includes('+') || (txt.includes('Rp') && !txt.includes('Sell now'))) {
                        completedCards.push({ el: card, txt: txt });
                    }
                }

                if (completedCards.length === 0) return;

                // Initial Page Load History Sync
                if (!hasSyncedHistoryOnLoad) {
                    let totalLosses = 0;
                    let totalWins = 0;
                    let pnl = 0;
                    let consecutiveLosses = 0;
                    let foundWin = false;

                    for (const item of completedCards) {
                        const txt = item.txt;
                        if ((txt.includes('0 Rp') || txt.includes('0.00') || txt.includes('0 $')) && !txt.includes('+') && !txt.includes('Sell now')) {
                            totalLosses++;
                            pnl -= 15000;
                            if (!foundWin) consecutiveLosses++;
                        } else if (txt.includes('+') && !txt.includes('Sell now')) {
                            totalWins++;
                            const match = txt.match(/\+([\d,.]+)/);
                            const amt = match ? parseFloat(match[1].replace(/,/g, '')) : 14000;
                            pnl += amt;
                            foundWin = true;
                        }
                    }

                    STATE.wins = totalWins;
                    STATE.losses = totalLosses;
                    STATE.totalTrades = totalWins + totalLosses;
                    STATE.totalPnL = pnl;
                    STATE.currentLevel = Math.min(consecutiveLosses, CONFIG.maxLevel);
                    STATE.currentStake = CONFIG.martingaleSteps[STATE.currentLevel];
                    hasSyncedHistoryOnLoad = true;
                    this.lastTopTradeEl = completedCards[0].el;
                    this.lastCompletedCount = completedCards.length;
                    this.syncInputField();
                    UI.updateHUD();
                    return;
                }

                // Dynamic new trade detection
                const currentTop = completedCards[0];
                const currentCount = completedCards.length;

                // Trigger if top card element changed OR total completed count increased
                if (currentTop.el !== this.lastTopTradeEl || currentCount > this.lastCompletedCount) {
                    this.lastTopTradeEl = currentTop.el;
                    this.lastCompletedCount = currentCount;

                    const txt = currentTop.txt;
                    console.log("%c[QUOTEX-BOT] New Completed Trade Result:", "color: #00ffcc; font-weight: bold;", txt);

                    if (txt.includes('+')) {
                        // WIN -> Reset to Base
                        const match = txt.match(/\+([\d,.]+)/);
                        const amt = match ? parseFloat(match[1].replace(/,/g, '')) : 14000;
                        Martingale.recordWin(amt);
                    } else if (txt.includes('0 Rp') || txt.includes('0.00') || txt.includes('0 $') || !txt.includes('+')) {
                        // LOSS -> Step up Martingale
                        Martingale.recordLoss(STATE.currentStake || 15000);
                    }
                }
            } catch (e) {
                console.error("[QUOTEX-BOT] Trade sync error:", e);
            }
        },

        setInputValue(inputEl, value) {
            if (!inputEl) return;
            try {
                inputEl.focus();
                const strVal = String(value);

                // Set value property descriptor
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                if (nativeSetter) {
                    nativeSetter.call(inputEl, strVal);
                } else {
                    inputEl.value = strVal;
                }

                // Reset React value tracker to force state re-render
                const tracker = inputEl._valueTracker;
                if (tracker) {
                    tracker.setValue(strVal + "_prev");
                }

                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                inputEl.blur();
            } catch (e) {
                inputEl.value = value;
            }
        },

        syncInputField() {
            const input = this.getAmountInput();
            if (input) {
                const cur = parseInt(input.value.replace(/[^0-9]/g, ''), 10);
                const target = Martingale.getCurrentStake();
                if (cur !== target && target > 0) {
                    this.setInputValue(input, target);
                }
            }
        },

        executeTrade(direction, stake) {
            const isBuy = direction === "BUY";
            const btn = isBuy ? this.getBuyButton() : this.getSellButton();
            const input = this.getAmountInput();

            if (!btn) return false;
            const targetStake = Martingale.getCurrentStake() || stake || 15000;
            if (input) this.setInputValue(input, targetStake);

            const preOrderBalance = this.readBalance();

            setTimeout(() => {
                try {
                    if (input) this.setInputValue(input, targetStake);
                    btn.click();
                    Sound.play('entry');

                    STATE.activeTrade = {
                        direction: direction,
                        stake: targetStake,
                        level: STATE.currentLevel,
                        preOrderBalance: preOrderBalance,
                        timestamp: Date.now()
                    };

                    Bridge.send({
                        type: "TRADE_EXECUTED",
                        direction: direction,
                        stake: targetStake,
                        level: STATE.currentLevel,
                        market: STATE.activeMarket,
                        candle_time: new Date().toLocaleTimeString()
                    });
                } catch (e) {}
            }, 80);

            return true;
        }
    };

    // ==========================================
    // 8. MARTINGALE & PNL RESOLUTION (Rule 6)
    // ==========================================
    const Martingale = {
        getCurrentStake() {
            if (STATE.isStoppedK6) return 0;
            const lvl = Math.min(STATE.currentLevel, CONFIG.martingaleSteps.length - 1);
            return CONFIG.martingaleSteps[lvl];
        },

        getLevelLabel() {
            if (STATE.currentLevel === 0) return "Base";
            return `K${STATE.currentLevel}`;
        },

        recordWin(payout = 0) {
            STATE.wins += 1;
            STATE.totalTrades += 1;
            STATE.totalPnL += payout;
            
            STATE.currentLevel = 0;
            STATE.currentStake = CONFIG.martingaleSteps[0];
            STATE.isStoppedK6 = false;

            Sound.play('win');
            Bridge.send({ type: "TRADE_RESULT", result: "WIN", payout: payout, balance: STATE.currentBalance });
            QuotexDOM.syncInputField();
            UI.updateHUD();
        },

        recordLoss(lossAmount = 0) {
            STATE.losses += 1;
            STATE.totalTrades += 1;
            STATE.totalPnL -= lossAmount;

            if (STATE.currentLevel >= CONFIG.maxLevel) {
                STATE.isStoppedK6 = true;
                STATE.currentStake = 0;
                Sound.play('k6_alarm');
            } else {
                STATE.currentLevel += 1;
                STATE.currentStake = this.getCurrentStake();
                Sound.play('loss');
            }

            Bridge.send({ type: "TRADE_RESULT", result: "LOSS", payout: -lossAmount, balance: STATE.currentBalance });
            QuotexDOM.syncInputField();
            UI.updateHUD();
        },

        resetAll() {
            STATE.currentLevel = 0;
            STATE.currentStake = CONFIG.martingaleSteps[0];
            STATE.isStoppedK6 = false;
            STATE.wins = 0;
            STATE.losses = 0;
            STATE.totalTrades = 0;
            STATE.totalPnL = 0;
            QuotexDOM.syncInputField();
            Bridge.send({ type: "UPDATE_CONFIG", reset_k6: true });
            UI.updateHUD();
        }
    };

    // ==========================================
    // 9. PRECISION ENTRY TIMING LOOP (Rule 8)
    // ==========================================
    function startMainTimerLoop() {
        setInterval(() => {
            const now = Date.now();
            const candleInterval = CONFIG.timeframeSec * 1000;
            const currentBucket = Math.floor(now / candleInterval) * candleInterval;
            const remainingMs = candleInterval - (now % candleInterval);
            const remainingSec = Math.floor(remainingMs / 1000);
            const remainingDecimal = ((remainingMs % 1000) / 100).toFixed(0);

            STATE.candleCountdown = remainingSec;

            // Detect Market & Payout
            QuotexDOM.readMarketAndPayout();
            QuotexDOM.syncLiveTradesHistory();

            // Continuous Live Price Ingest
            const domPrice = QuotexDOM.readLiveChartPrice();
            if (domPrice > 0) {
                CandleStore.addLiveTick(domPrice, now);
            }

            // Balance & Trade resolution
            const domBal = QuotexDOM.readBalance();
            if (domBal > 0) {
                if (STATE.startBalance === 0) STATE.startBalance = domBal;
                
                if (STATE.activeTrade && (now - STATE.activeTrade.timestamp >= 29000)) {
                    const preBal = STATE.activeTrade.preOrderBalance;
                    const stake = STATE.activeTrade.stake;

                    if (domBal > preBal) {
                        const netProfit = domBal - preBal;
                        Martingale.recordWin(netProfit);
                    } else {
                        Martingale.recordLoss(stake);
                    }
                    STATE.activeTrade = null;
                }
                STATE.currentBalance = domBal;
            }

            // Timer display on HUD
            const timerEl = document.getElementById('qtx-mini-timer');
            if (timerEl) {
                timerEl.innerText = `${remainingSec.toString().padStart(2, '0')}.${remainingDecimal}s`;
                if (remainingMs <= 1500) timerEl.style.color = "#ff0055";
                else timerEl.style.color = "#00ffcc";
            }

            // Auto-sync input
            if (STATE.isBotActive) QuotexDOM.syncInputField();

            // Entry Trigger (Detik 1 menuju 0)
            if (STATE.isBotActive && !STATE.isStoppedK6) {
                if (remainingMs <= 1200 && remainingMs >= 200) {
                    if (STATE.lastEntryCandleTimestamp !== currentBucket) {
                        STATE.lastEntryCandleTimestamp = currentBucket;
                        if (STATE.currentSignal === "BUY" || STATE.currentSignal === "SELL") {
                            QuotexDOM.executeTrade(STATE.currentSignal, Martingale.getCurrentStake());
                        }
                    }
                }
            }

            Engine.evaluate();
        }, 100);
    }

    // ==========================================
    // 10. SLEEK MINI HUD
    // ==========================================
    const UI = {
        hudEl: null,

        createHUD() {
            if (document.getElementById('quotex-mini-hud')) return;

            const hud = document.createElement('div');
            hud.id = 'quotex-mini-hud';
            hud.innerHTML = `
                <div id="qtx-mini-head">
                    <div class="qtx-head-left">
                        <span class="qtx-dot"></span>
                        <span class="qtx-head-title">MACD (4,12,9)</span>
                        <span id="qtx-bridge-pill" class="qtx-pill pill-offline">OFFLINE</span>
                    </div>
                    <div class="qtx-head-right">
                        <span id="qtx-sound-btn" title="Toggle Sound">🔊</span>
                    </div>
                </div>

                <div id="qtx-mini-body">
                    <div class="qtx-mini-row">
                        <div class="qtx-box">
                            <span class="qtx-lbl">MARKET</span>
                            <div class="qtx-mkt-row">
                                <span id="qtx-market-txt" class="qtx-val-bold">AUD/CHF (OTC)</span>
                                <span id="qtx-payout-badge" class="qtx-payout-tag">94%</span>
                            </div>
                        </div>
                        <div class="qtx-box text-right">
                            <span class="qtx-lbl">TIMER (30s)</span>
                            <span id="qtx-mini-timer" class="qtx-val-cyan">30.0s</span>
                        </div>
                    </div>

                    <div id="qtx-signal-box" class="sig-hold">
                        <div id="qtx-sig-text" class="sig-title">⏸️ HOLD (MEPET)</div>
                        <div id="qtx-sig-sub" class="sig-subtitle">Sinkronisasi Chart...</div>
                    </div>

                    <div class="qtx-mini-row macd-grid">
                        <div class="qtx-box">
                            <span class="qtx-lbl">MACD (HIJAU)</span>
                            <span id="qtx-val-green" class="qtx-val-g">0.000000</span>
                        </div>
                        <div class="qtx-box">
                            <span class="qtx-lbl">SIGNAL (MERAH)</span>
                            <span id="qtx-val-red" class="qtx-val-r">0.000000</span>
                        </div>
                        <div class="qtx-box text-right">
                            <span class="qtx-lbl">DELTA</span>
                            <span id="qtx-val-delta" class="qtx-val-w">0.000000</span>
                        </div>
                    </div>

                    <div class="qtx-mini-row">
                        <div class="qtx-box">
                            <span class="qtx-lbl">PNL TOTAL</span>
                            <span id="qtx-pnl-txt" class="qtx-val-pnl">Rp 0</span>
                        </div>
                        <div class="qtx-box text-right">
                            <span class="qtx-lbl">STAKE (<span id="qtx-k-lvl">Base</span>)</span>
                            <span id="qtx-stake-txt" class="qtx-val-gold">Rp 15.000</span>
                        </div>
                    </div>

                    <div class="qtx-wl-strip">
                        <span>Win/Loss: <strong id="qtx-wl-txt">0W / 0L</strong></span>
                        <span>WR: <strong id="qtx-wr-txt">0%</strong></span>
                    </div>

                    <div class="qtx-btn-group">
                        <button id="qtx-toggle-btn" class="qtx-btn-action btn-start">▶ START BOT</button>
                        <button id="qtx-reset-btn" class="qtx-btn-action btn-rst" title="Reset Martingale">🔄</button>
                    </div>
                </div>
            `;

            const style = document.createElement('style');
            style.innerHTML = `
                #quotex-mini-hud {
                    position: fixed;
                    top: 15px;
                    right: 15px;
                    width: 260px;
                    background: rgba(13, 17, 23, 0.94);
                    backdrop-filter: blur(14px);
                    -webkit-backdrop-filter: blur(14px);
                    border: 1px solid rgba(0, 255, 204, 0.35);
                    border-radius: 12px;
                    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.75), 0 0 15px rgba(0, 255, 204, 0.15);
                    color: #e6edf3;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 11px;
                    z-index: 99999999;
                    user-select: none;
                }
                #qtx-mini-head {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    background: rgba(22, 27, 34, 0.96);
                    border-top-left-radius: 12px;
                    border-top-right-radius: 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    cursor: move;
                }
                .qtx-head-left {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .qtx-dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background: #00ffcc;
                    box-shadow: 0 0 6px #00ffcc;
                }
                .qtx-head-title {
                    font-weight: 700;
                    font-size: 11.5px;
                    color: #00ffcc;
                    letter-spacing: 0.3px;
                }
                .qtx-pill {
                    font-size: 8.5px;
                    font-weight: 700;
                    padding: 1px 5px;
                    border-radius: 4px;
                    text-transform: uppercase;
                }
                .pill-online { background: rgba(0, 255, 136, 0.2); color: #00ff88; border: 1px solid #00ff88; }
                .pill-local { background: rgba(0, 180, 255, 0.2); color: #00b4ff; border: 1px solid #00b4ff; }
                .pill-offline { background: rgba(255, 0, 85, 0.2); color: #ff0055; border: 1px solid #ff0055; }
                
                .qtx-head-right span {
                    cursor: pointer;
                    opacity: 0.75;
                    font-size: 13px;
                }
                .qtx-head-right span:hover { opacity: 1; }

                #qtx-mini-body {
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .qtx-mini-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 6px;
                }
                .qtx-mkt-row {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .qtx-payout-tag {
                    background: rgba(255, 170, 0, 0.2);
                    color: #ffaa00;
                    border: 1px solid rgba(255, 170, 0, 0.4);
                    font-weight: 800;
                    font-size: 9.5px;
                    padding: 1px 4px;
                    border-radius: 4px;
                }
                .macd-grid {
                    background: rgba(22, 27, 34, 0.7);
                    padding: 6px;
                    border-radius: 6px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
                .qtx-box {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .text-right { text-align: right; }
                .qtx-lbl {
                    font-size: 8.5px;
                    color: #8b949e;
                    text-transform: uppercase;
                    font-weight: 600;
                }
                .qtx-val-bold {
                    font-size: 11.5px;
                    font-weight: 700;
                    color: #fff;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 120px;
                }
                .qtx-val-cyan {
                    font-size: 13px;
                    font-family: monospace;
                    font-weight: 700;
                    color: #00ffcc;
                }
                .qtx-val-g { color: #00ff88; font-family: monospace; font-size: 10px; font-weight: 700; }
                .qtx-val-r { color: #ff0055; font-family: monospace; font-size: 10px; font-weight: 700; }
                .qtx-val-w { color: #fff; font-family: monospace; font-size: 10px; font-weight: 700; }
                .qtx-val-gold { color: #ffd700; font-weight: 700; font-size: 11.5px; }
                .qtx-val-pnl { font-size: 11.5px; font-weight: 700; color: #8b949e; }
                .pnl-green { color: #00ff88; }
                .pnl-red { color: #ff0055; }

                #qtx-signal-box {
                    padding: 8px;
                    border-radius: 8px;
                    text-align: center;
                    transition: all 0.25s ease;
                }
                .sig-title {
                    font-size: 13.5px;
                    font-weight: 800;
                    letter-spacing: 0.5px;
                }
                .sig-subtitle {
                    font-size: 9.5px;
                    opacity: 0.85;
                    margin-top: 2px;
                }
                .sig-buy {
                    background: linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 150, 80, 0.25));
                    border: 1px solid #00ff88;
                    color: #00ff88;
                    box-shadow: 0 0 12px rgba(0, 255, 136, 0.2);
                }
                .sig-sell {
                    background: linear-gradient(135deg, rgba(255, 0, 85, 0.2), rgba(180, 0, 60, 0.25));
                    border: 1px solid #ff0055;
                    color: #ff0055;
                    box-shadow: 0 0 12px rgba(255, 0, 85, 0.2);
                }
                .sig-hold {
                    background: rgba(255, 170, 0, 0.15);
                    border: 1px solid #ffaa00;
                    color: #ffaa00;
                }
                .sig-stopped {
                    background: rgba(255, 0, 0, 0.35);
                    border: 1.5px solid #ff0033;
                    color: #fff;
                    box-shadow: 0 0 15px rgba(255, 0, 0, 0.4);
                }

                .qtx-wl-strip {
                    display: flex;
                    justify-content: space-between;
                    font-size: 9.5px;
                    color: #8b949e;
                    background: rgba(22, 27, 34, 0.5);
                    padding: 4px 8px;
                    border-radius: 4px;
                }
                .qtx-wl-strip strong { color: #fff; }

                .qtx-btn-group {
                    display: grid;
                    grid-template-columns: 1fr 34px;
                    gap: 6px;
                }
                .qtx-btn-action {
                    padding: 8px;
                    border-radius: 6px;
                    font-weight: 700;
                    font-size: 11px;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .btn-start {
                    background: linear-gradient(135deg, #00cc88, #009966);
                    color: #fff;
                    box-shadow: 0 3px 10px rgba(0, 204, 136, 0.3);
                }
                .btn-start:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .btn-stop {
                    background: linear-gradient(135deg, #ff0055, #cc0044);
                    color: #fff;
                    box-shadow: 0 3px 10px rgba(255, 0, 85, 0.3);
                }
                .btn-rst {
                    background: rgba(255, 255, 255, 0.08);
                    color: #e6edf3;
                    border: 1px solid rgba(255, 255, 255, 0.15);
                }
                .btn-rst:hover { background: rgba(255, 255, 255, 0.18); }
            `;
            document.head.appendChild(style);
            document.body.appendChild(hud);

            this.hudEl = hud;
            this.attachEvents();
            this.makeDraggable(hud, document.getElementById('qtx-mini-head'));
        },

        attachEvents() {
            const btnToggle = document.getElementById('qtx-toggle-btn');
            btnToggle.addEventListener('click', () => {
                if (STATE.isStoppedK6) {
                    alert("⛔ Bot terhenti karena batas K6 loss tercapai. Klik tombol 🔄 untuk reset.");
                    return;
                }
                STATE.isBotActive = !STATE.isBotActive;
                if (STATE.isBotActive) {
                    btnToggle.innerText = "⏸ STOP BOT";
                    btnToggle.className = "qtx-btn-action btn-stop";
                    QuotexDOM.syncInputField();
                } else {
                    btnToggle.innerText = "▶ START BOT";
                    btnToggle.className = "qtx-btn-action btn-start";
                }
                Bridge.send({ type: "UPDATE_CONFIG", is_bot_running: STATE.isBotActive });
                Engine.evaluate();
                this.updateHUD();
            });

            const btnReset = document.getElementById('qtx-reset-btn');
            btnReset.addEventListener('click', () => Martingale.resetAll());

            const btnSound = document.getElementById('qtx-sound-btn');
            btnSound.addEventListener('click', () => {
                STATE.soundEnabled = !STATE.soundEnabled;
                btnSound.innerText = STATE.soundEnabled ? "🔊" : "🔇";
            });
        },

        makeDraggable(element, handle) {
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
            handle.onmousedown = (e) => {
                e.preventDefault();
                pos3 = e.clientX;
                pos4 = e.clientY;
                document.onmouseup = () => {
                    document.onmouseup = null;
                    document.onmousemove = null;
                };
                document.onmousemove = (e2) => {
                    e2.preventDefault();
                    pos1 = pos3 - e2.clientX;
                    pos2 = pos4 - e2.clientY;
                    pos3 = e2.clientX;
                    pos4 = e2.clientY;
                    element.style.top = (element.offsetTop - pos2) + "px";
                    element.style.left = (element.offsetLeft - pos1) + "px";
                    element.style.right = 'auto';
                };
            };
        },

        updateHUD() {
            if (!this.hudEl) return;

            const pill = document.getElementById('qtx-bridge-pill');
            if (pill) {
                if (STATE.bridgeStatus === "CONNECTED") {
                    pill.innerText = "ONLINE";
                    pill.className = "qtx-pill pill-online";
                } else if (STATE.bridgeStatus === "LOCAL_MODE") {
                    pill.innerText = "LOCAL";
                    pill.className = "qtx-pill pill-local";
                } else {
                    pill.innerText = "OFFLINE";
                    pill.className = "qtx-pill pill-offline";
                }
            }

            const mkt = document.getElementById('qtx-market-txt');
            if (mkt) mkt.innerText = STATE.activeMarket;

            const payoutTag = document.getElementById('qtx-payout-badge');
            if (payoutTag) payoutTag.innerText = STATE.activePayout;

            const sigBox = document.getElementById('qtx-signal-box');
            const sigTitle = document.getElementById('qtx-sig-text');
            const sigSub = document.getElementById('qtx-sig-sub');

            if (sigBox && sigTitle && sigSub) {
                if (STATE.isStoppedK6) {
                    sigBox.className = "sig-stopped";
                    sigTitle.innerText = "⛔ STOP (K6 LOSS)";
                    sigSub.innerText = "Maksimum K6 tercapai.";
                } else if (!STATE.isBotActive) {
                    sigBox.className = "sig-hold";
                    sigTitle.innerText = "⏸️ STANDBY";
                    sigSub.innerText = "Klik Start Bot untuk mulai";
                } else if (STATE.currentSignal === "BUY") {
                    sigBox.className = "sig-buy";
                    sigTitle.innerText = "🟢 CALL / BUY";
                    sigSub.innerText = STATE.signalReason;
                } else if (STATE.currentSignal === "SELL") {
                    sigBox.className = "sig-sell";
                    sigTitle.innerText = "🔴 PUT / SELL";
                    sigSub.innerText = STATE.signalReason;
                } else {
                    sigBox.className = "sig-hold";
                    sigTitle.innerText = "⏸️ HOLD (MEPET)";
                    sigSub.innerText = STATE.signalReason;
                }
            }

            const valG = document.getElementById('qtx-val-green');
            const valR = document.getElementById('qtx-val-red');
            const valD = document.getElementById('qtx-val-delta');

            const decimals = STATE.currentPrice > 10 ? 4 : 6;
            if (valG) valG.innerText = (STATE.macdLine || 0).toFixed(decimals);
            if (valR) valR.innerText = (STATE.signalLine || 0).toFixed(decimals);
            if (valD) valD.innerText = (STATE.hist || 0).toFixed(decimals);

            const pnl = document.getElementById('qtx-pnl-txt');
            if (pnl) {
                const s = STATE.totalPnL > 0 ? "+" : "";
                pnl.innerText = `${s}Rp ${STATE.totalPnL.toLocaleString('id-ID')}`;
                pnl.className = `qtx-val-pnl ${STATE.totalPnL > 0 ? 'pnl-green' : (STATE.totalPnL < 0 ? 'pnl-red' : '')}`;
            }

            const kLvl = document.getElementById('qtx-k-lvl');
            if (kLvl) kLvl.innerText = Martingale.getLevelLabel();

            const stk = document.getElementById('qtx-stake-txt');
            if (stk) stk.innerText = `Rp ${Martingale.getCurrentStake().toLocaleString('id-ID')}`;

            const wl = document.getElementById('qtx-wl-txt');
            if (wl) wl.innerText = `${STATE.wins}W / ${STATE.losses}L`;

            const wr = document.getElementById('qtx-wr-txt');
            if (wr) {
                const rate = STATE.totalTrades > 0 ? ((STATE.wins / STATE.totalTrades) * 100).toFixed(0) : "0";
                wr.innerText = `${rate}%`;
            }
        }
    };

    // ==========================================
    // 11. BOOTSTRAP
    // ==========================================
    function init() {
        Bridge.connect();
        startMainTimerLoop();

        const checkReady = setInterval(() => {
            if (document.body) {
                clearInterval(checkReady);
                UI.createHUD();
                UI.updateHUD();
                QuotexDOM.syncInputField();
            }
        }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
