const mongoose = require("mongoose");

const tournamentSchema = new mongoose.Schema({
  game: String,
  entryFee: Number,
  maxPlayers: Number,
  players: [String],
  startTime: Date,
  roomId: String,
  password: String,
}, { timestamps: true });

module.exports = mongoose.model("Tournament", tournamentSchema);
