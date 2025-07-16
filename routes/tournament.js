const express = require("express");
const Tournament = require("../models/Tournament");
const Wallet = require("../models/walletModel");
const router = express.Router();

// 🎯 Create Tournament
router.post("/create", async (req, res) => {
  try {
    const {
      game,
      entryFee,
      maxPlayers,
      startTime,
      roomId,
      password,
    } = req.body;

    const newTournament = new Tournament({
      game,
      entryFee,
      maxPlayers,
      startTime,
      roomId,
      password,
      players: [],
    });

    await newTournament.save();
    res.json({ success: true, tournament: newTournament });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🎮 Join Tournament & Deduct Wallet Money
router.post("/join", async (req, res) => {
  const { tournamentId, phone } = req.body;

  try {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament)
      return res.status(404).json({ message: "Tournament not found" });

    if (tournament.players.includes(phone)) {
      return res.status(400).json({ message: "Player already joined" });
    }

    if (tournament.players.length >= tournament.maxPlayers) {
      return res.status(400).json({ message: "Tournament full" });
    }

    const wallet = await Wallet.findOne({ phone });
    if (!wallet || wallet.balance < tournament.entryFee) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    wallet.balance -= tournament.entryFee;
    await wallet.save();

    tournament.players.push(phone);
    await tournament.save();

    res.json({
      success: true,
      message: "Joined and fee deducted",
      tournament,
      balance: wallet.balance,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get tournament details (roomId/password visible only within 30 mins before start)
router.get("/:id", async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Tournament not found" });

    const now = new Date();
    const startTime = new Date(t.startTime);
    const timeDiffMinutes = (startTime - now) / (1000 * 60);

    const includeRoomDetails = timeDiffMinutes <= 30;

    const tournamentData = {
      _id: t._id,
      game: t.game,
      entryFee: t.entryFee,
      maxPlayers: t.maxPlayers,
      players: t.players,
      startTime: t.startTime,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };

    if (includeRoomDetails) {
      tournamentData.roomId = t.roomId;
      tournamentData.password = t.password;
    }

    res.json(tournamentData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📋 Get tournaments joined by a player (hide after 15 mins of startTime)
router.get("/joined/:phone", async (req, res) => {
  try {
    const now = new Date();
    const tournaments = await Tournament.find({ players: req.params.phone });

    const activeTournaments = tournaments.filter((t) => {
      const startTime = new Date(t.startTime);
      const timeDiffMinutes = (now - startTime) / (1000 * 60);
      return timeDiffMinutes <= 15;
    });

    // ✅ FIXED RETURN STRUCTURE
    res.json({
      success: true,
      tournaments: activeTournaments,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


// 🌐 Get all upcoming tournaments
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const tournaments = await Tournament.find({ startTime: { $gt: now } });

    res.json({
      success: true,
      tournaments,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
