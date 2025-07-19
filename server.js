require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const User = require("./models/userModel");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// OTP Store and Rate Limiting
const otpStore = new Map();
const rateLimitStore = new Map();

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const checkRateLimit = (phone) => {
  const now = Date.now();
  const key = `rate_${phone}`;
  const attempts = rateLimitStore.get(key) || [];
  const validAttempts = attempts.filter(timestamp => now - timestamp < 60 * 60 * 1000);
  if (validAttempts.length >= 5) return false;
  validAttempts.push(now);
  rateLimitStore.set(key, validAttempts);
  return true;
};

const cleanupExpired = () => {
  const now = Date.now();
  for (const [phone, data] of otpStore.entries()) {
    if (data.expiresAt < now) otpStore.delete(phone);
  }
  for (const [key, attempts] of rateLimitStore.entries()) {
    const validAttempts = attempts.filter(timestamp => now - timestamp < 60 * 60 * 1000);
    if (validAttempts.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, validAttempts);
    }
  }
};
setInterval(cleanupExpired, 5 * 60 * 1000);

const validatePhoneNumber = (phone) => /^[6-9]\d{9}$/.test(phone);

const sendWhatsAppOtpGupshup = async (phone, otp) => {
  try {
    const {
      GUPSHUP_API_KEY,
      GUPSHUP_SENDER,
      GUPSHUP_APP_NAME = "GupshupApp",
      GUPSHUP_TEMPLATE_NAME = "otp_verification_code",
      OTP_EXPIRY_MINUTES = 5
    } = process.env;

    if (!GUPSHUP_API_KEY || !GUPSHUP_SENDER || !GUPSHUP_TEMPLATE_NAME) {
      throw new Error("Gupshup credentials or template name missing");
    }

    const formattedPhone = phone.startsWith('91') ? phone : `91${phone}`;

    const payload = new URLSearchParams({
      channel: "whatsapp",
      source: GUPSHUP_SENDER,
      destination: formattedPhone,
      "src.name": GUPSHUP_APP_NAME,
      template: GUPSHUP_TEMPLATE_NAME,
      "template.params": `${otp}|${OTP_EXPIRY_MINUTES}`
    });

    const response = await axios.post(
      `https://api.gupshup.io/sm/api/v1/template/msg`,
      payload,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          apikey: GUPSHUP_API_KEY
        },
        timeout: 15000
      }
    );

    if (["submitted", "queued"].includes(response.data?.status) || response.data?.messageId) {
      return {
        success: true,
        messageId: response.data.messageId,
        status: response.data.status
      };
    } else {
      throw new Error(`Unexpected Gupshup response: ${JSON.stringify(response.data)}`);
    }

  } catch (error) {
    if (error.response) {
      const msg = error.response.data?.message || "Invalid parameters";
      switch (error.response.status) {
        case 401:
          throw new Error("Invalid Gupshup API key");
        case 400:
          throw new Error(`Bad request: ${msg}`);
        case 429:
          throw new Error("Rate limit exceeded on Gupshup API");
      }
    } else if (error.request) {
      throw new Error("No response from Gupshup API");
    }
    throw new Error(`Gupshup error: ${error.message}`);
  }
};

// Health Check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: {
      gupshup_api_key: process.env.GUPSHUP_API_KEY ? 'Present' : 'Missing',
      gupshup_sender: process.env.GUPSHUP_SENDER ? 'Present' : 'Missing',
      gupshup_template: process.env.GUPSHUP_TEMPLATE_NAME || 'otp_verification_code'
    }
  });
});

// Root Route
app.get("/", (req, res) => {
  res.send("🚀 OTP Backend is live!");
});

// Send OTP Endpoint
app.post("/send-otp", async (req, res) => {
  try {
    const { phone, consentGiven } = req.body;

    if (!phone) return res.status(400).json({ success: false, message: "Phone number is required" });

    const normalizedPhone = phone.replace(/\D/g, '').replace(/^91/, '');

    if (!validatePhoneNumber(normalizedPhone)) {
      return res.status(400).json({ success: false, message: "Invalid Indian phone number" });
    }

    if (!consentGiven) {
      return res.status(400).json({ success: false, message: "User consent is required" });
    }

    if (!checkRateLimit(normalizedPhone)) {
      return res.status(429).json({ success: false, message: "Too many OTP requests. Try again in 1 hour." });
    }

    const otp = generateOTP();
    const expiresAt = Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000;

    otpStore.set(normalizedPhone, { otp, expiresAt, attempts: 0, createdAt: Date.now() });

    const sendResult = await sendWhatsAppOtpGupshup(normalizedPhone, otp);

    const existingUser = await User.findOne({ phone: normalizedPhone });
    if (existingUser) {
      existingUser.termsAccepted = true;
      await existingUser.save();
    } else {
      await new User({ phone: normalizedPhone, termsAccepted: true }).save();
    }

    res.json({
      success: true,
      message: "OTP sent successfully via WhatsApp",
      expiresIn: Math.floor((expiresAt - Date.now()) / 1000),
      messageId: sendResult.messageId,
      status: sendResult.status
    });

  } catch (error) {
    console.error("❌ Error in /send-otp:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to send OTP" });
  }
});

// 404 Handler
app.use("*", (req, res) => {
  res.status(404).json({ success: false, message: "Endpoint not found" });
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT. Exiting...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM. Exiting...');
  process.exit(0);
});

// MongoDB Connection (✅ FIXED)
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Connected to MongoDB`);
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
  });
