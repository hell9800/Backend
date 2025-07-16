const express = require("express");
const router = express.Router();
const User = require("../models/userModel");

// Helper function to normalize phone numbers
const normalizePhone = (phone) => {
  // Remove any spaces, dashes, or other characters
  let normalized = phone.replace(/\D/g, '');
  
  // If it starts with 91, remove it (country code)
  if (normalized.startsWith('91') && normalized.length === 12) {
    normalized = normalized.substring(2);
  }
  
  return normalized;
};

// Login (via phone number)
router.post("/login", async (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^(\+91)?[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid Indian phone number" });
  }

  const normalizedPhone = normalizePhone(phone);

  try {
    let user = await User.findOne({ phone: normalizedPhone });

    if (!user) {
      // First-time login — create new user placeholder
      user = new User({ phone: normalizedPhone });
      await user.save();
      return res.json({ newUser: true, message: "Phone verified. Enter name and age." });
    }

    if (!user.name || !user.age) {
      return res.json({ newUser: true, message: "Complete profile (name and age)." });
    }

    if (user.age < 18) {
      await User.deleteOne({ phone: normalizedPhone });
      return res.status(403).json({ error: "You are not old enough, kiddo. Come back at 18!" });
    }

    if (!user.termsAccepted) {
      return res.json({ termsRequired: true, message: "Please accept Terms and Conditions" });
    }

    return res.json({ success: true, message: "Login successful", user });
  } catch (error) {
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

// Update Name & Age
router.post("/update-profile", async (req, res) => {
  const { phone, name, age } = req.body;

  if (!phone || !name || typeof age !== "number") {
    return res.status(400).json({ error: "Phone, name, and age required" });
  }

  if (age < 18) {
    const normalizedPhone = normalizePhone(phone);
    await User.deleteOne({ phone: normalizedPhone });
    return res.status(403).json({ error: "You are not old enough, kiddo. Come back at 18!" });
  }

  const normalizedPhone = normalizePhone(phone);

  try {
    let user = await User.findOne({ phone: normalizedPhone });

    if (!user) {
      // If user doesn't exist, create them (fallback safety)
      user = new User({ 
        phone: normalizedPhone,
        name: name.trim(),
        age: age 
      });
      await user.save();
      return res.json({ success: true, user, message: "Profile created successfully" });
    }

    // Update existing user
    user.name = name.trim();
    user.age = age;
    await user.save();

    return res.json({ success: true, user, message: "Profile updated successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

// Accept Terms & Conditions
router.post("/accept-terms", async (req, res) => {
  const { phone, accepted } = req.body;

  if (!phone || accepted !== true) {
    return res.status(400).json({ error: "Must accept terms" });
  }

  const normalizedPhone = normalizePhone(phone);

  try {
    const user = await User.findOneAndUpdate(
      { phone: normalizedPhone },
      { termsAccepted: true },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

module.exports = router;
