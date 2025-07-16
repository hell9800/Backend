const express = require("express");
const router = express.Router();
const Wallet = require("../models/walletModel");
const Razorpay = require("razorpay");

// 🔐 Razorpay instance (replace with your real keys)
const razorpay = new Razorpay({
  key_id: "your_razorpay_key_id",
  key_secret: "your_razorpay_secret"
});

// 🟢 Generate Razorpay order
router.post("/create-order", async (req, res) => {
  const { amount } = req.body;

  try {
    const options = {
      amount: amount * 100, // amount in paisa
      currency: "INR",
      receipt: "wallet_order_rcptid"
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Add money after successful payment
router.post("/add", async (req, res) => {
  const { phone, amount } = req.body;

  try {
    let wallet = await Wallet.findOne({ phone });
    if (!wallet) {
      wallet = new Wallet({ phone, balance: amount });
    } else {
      wallet.balance += amount;
    }
    await wallet.save();
    res.json({ message: "Money added", balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📤 Get wallet balance
router.get("/balance/:phone", async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ phone: req.params.phone });
    if (!wallet) return res.json({ balance: 0 });
    res.json({ balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🪙 Add prize money to wallet (for winners)
router.post("/add-prize", async (req, res) => {
  const { phone, prize } = req.body;
  try {
    const wallet = await Wallet.findOne({ phone });
    if (!wallet) return res.status(404).json({ message: "Wallet not found" });
    wallet.balance += prize;
    await wallet.save();
    res.json({ message: "Prize added", balance: wallet.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

