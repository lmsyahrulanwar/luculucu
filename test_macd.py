#!/usr/bin/env python3
"""
Unit tests for MACD (4, 12, 9) and Martingale Manager.
"""
import unittest
from bridge_server import MACDCalculator, MartingaleManager, MARTINGALE_STEPS, MAX_MARTINGALE_LEVEL

class TestTradingBotLogic(unittest.TestCase):
    def setUp(self):
        self.macd = MACDCalculator(fast=4, slow=12, signal=9)
        self.mm = MartingaleManager(steps=MARTINGALE_STEPS, max_level=MAX_MARTINGALE_LEVEL)

    def test_martingale_initial_and_win(self):
        # Initial stake should be 15000
        self.assertEqual(self.mm.get_current_stake(), 15000)
        self.assertEqual(self.mm.current_level, 0)

        # Record a WIN
        res = self.mm.record_trade_result("WIN", 12500)
        self.assertEqual(res["current_level"], 0)
        self.assertEqual(res["next_stake"], 15000)
        self.assertEqual(res["wins"], 1)
        self.assertEqual(res["total_pnl"], 12500)

    def test_martingale_loss_sequence_up_to_k6(self):
        expected_stakes = [15000, 35000, 77000, 165000, 350000, 747000, 1611000]
        
        # Initial is Level 0 (15000)
        self.assertEqual(self.mm.get_current_stake(), expected_stakes[0])

        # Loss 1 -> K1 (35,000)
        res1 = self.mm.record_trade_result("LOSS", 15000)
        self.assertEqual(res1["current_level"], 1)
        self.assertEqual(res1["next_stake"], 35000)
        self.assertFalse(res1["is_stopped"])

        # Loss 2 -> K2 (77,000)
        res2 = self.mm.record_trade_result("LOSS", 35000)
        self.assertEqual(res2["current_level"], 2)
        self.assertEqual(res2["next_stake"], 77000)

        # Loss 3 -> K3 (165,000)
        res3 = self.mm.record_trade_result("LOSS", 77000)
        self.assertEqual(res3["current_level"], 3)
        self.assertEqual(res3["next_stake"], 165000)

        # Loss 4 -> K4 (350,000)
        res4 = self.mm.record_trade_result("LOSS", 165000)
        self.assertEqual(res4["current_level"], 4)
        self.assertEqual(res4["next_stake"], 350000)

        # Loss 5 -> K5 (747,000)
        res5 = self.mm.record_trade_result("LOSS", 35000)
        self.assertEqual(res5["current_level"], 5)
        self.assertEqual(res5["next_stake"], 747000)

        # Loss 6 -> K6 (1,611,000)
        res6 = self.mm.record_trade_result("LOSS", 747000)
        self.assertEqual(res6["current_level"], 6)
        self.assertEqual(res6["next_stake"], 1611000)
        self.assertFalse(res6["is_stopped"])

        # Loss at K6 -> MUST STOP ENTRY (Rule 6: kalo loss sampai K6 maka gua stop entry)
        res7 = self.mm.record_trade_result("LOSS", 1611000)
        self.assertTrue(res7["is_stopped"])
        self.assertEqual(self.mm.get_current_stake(), 0)
        self.assertIn("STOP ENTRY AKTIF", res7["message"])

    def test_win_after_loss_resets_to_base(self):
        # Loss 1 -> K1
        self.mm.record_trade_result("LOSS", 15000)
        self.assertEqual(self.mm.current_level, 1)
        self.assertEqual(self.mm.get_current_stake(), 35000)

        # Loss 2 -> K2
        self.mm.record_trade_result("LOSS", 35000)
        self.assertEqual(self.mm.current_level, 2)
        self.assertEqual(self.mm.get_current_stake(), 77000)

        # Win at K2 -> Reset to 0 (15,000)
        res = self.mm.record_trade_result("WIN", 65000)
        self.assertEqual(res["current_level"], 0)
        self.assertEqual(res["next_stake"], 15000)
        self.assertEqual(self.mm.get_current_stake(), 15000)

    def test_macd_bullish_and_bearish(self):
        # Rising prices should produce MACD line > Signal line (Bullish / BUY)
        prices = [1.0800, 1.0805, 1.0810, 1.0818, 1.0825, 1.0835, 1.0845, 1.0860]
        result = None
        for p in prices:
            result = self.macd.update_with_price(p)
        
        self.assertGreater(result["macd_line"], result["signal_line"])
        self.assertGreater(result["hist"], 0)

        # Falling prices should produce MACD line < Signal line (Bearish / SELL)
        bearish_prices = [1.0860, 1.0850, 1.0835, 1.0820, 1.0800, 1.0780, 1.0760]
        for p in bearish_prices:
            result = self.macd.update_with_price(p)
        
        self.assertLess(result["macd_line"], result["signal_line"])
        self.assertLess(result["hist"], 0)

if __name__ == "__main__":
    unittest.main()
