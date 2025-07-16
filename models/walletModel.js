const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  phone: {
    type: String,
    unique: true,
    required: true
  },
  balance: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model("Wallet", walletSchema);
