require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");

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

// OTP Store
const otpStore = new Map();
const rateLimitStore = new Map();

// ✅ Updated to generate a 6-digit OTP
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

// ✅ Enhanced WhatsApp OTP sending with better error handling
const sendWhatsAppOtpGupshup = async (phone, otp) => {
  try {
    const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
    const GUPSHUP_SENDER = process.env.GUPSHUP_SENDER;
    const GUPSHUP_APP_NAME = process.env.GUPSHUP_APP_NAME || "GupshupApp";
    const GUPSHUP_TEMPLATE_NAME = process.env.GUPSHUP_TEMPLATE_NAME || "otp_verification_code";
    const otpExpiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;

    console.log('🔧 Debug - Environment variables check:');
    console.log(`API Key: ${GUPSHUP_API_KEY ? 'Present' : 'Missing'}`);
    console.log(`Sender: ${GUPSHUP_SENDER ? GUPSHUP_SENDER : 'Missing'}`);
    console.log(`Template: ${GUPSHUP_TEMPLATE_NAME}`);
    console.log(`App Name: ${GUPSHUP_APP_NAME}`);

    if (!GUPSHUP_API_KEY || !GUPSHUP_SENDER || !GUPSHUP_TEMPLATE_NAME) {
      throw new Error("Gupshup credentials or template name missing");
    }

    // Format phone number properly
    const formattedPhone = phone.startsWith('91') ? phone : `91${phone}`;
    
    const payload = new URLSearchParams({
      channel: "whatsapp",
      source: GUPSHUP_SENDER,
      destination: formattedPhone,
      "src.name": GUPSHUP_APP_NAME,
      template: GUPSHUP_TEMPLATE_NAME,
      "template.params": `${otp}|${otpExpiryMinutes}`
    });

    console.log('📤 Sending request to Gupshup:');
    console.log(`URL: https://api.gupshup.io/sm/api/v1/template/msg`);
    console.log(`Destination: ${formattedPhone}`);
    console.log(`Template: ${GUPSHUP_TEMPLATE_NAME}`);
    console.log(`Params: ${otp}|${otpExpiryMinutes}`);

    const response = await axios.post(
      `https://api.gupshup.io/sm/api/v1/template/msg`,
      payload,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          apikey: GUPSHUP_API_KEY
        },
        timeout: 15000 // Increased timeout
      }
    );

    console.log('📥 Gupshup Response:');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));

    // Check for various success indicators
    if (response.data?.status === "submitted" || 
        response.data?.status === "queued" || 
        response.data?.messageId) {
      console.log(`✅ Template OTP sent to ${phone}`);
      return {
        success: true,
        messageId: response.data.messageId,
        status: response.data.status
      };
    } else {
      console.error('❌ Unexpected response from Gupshup:', response.data);
      throw new Error(`Gupshup API returned unexpected response: ${JSON.stringify(response.data)}`);
    }

  } catch (error) {
    console.error("❌ Gupshup API Error Details:");
    console.error("Error message:", error.message);
    
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response headers:", error.response.headers);
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
      
      // Handle specific error cases
      if (error.response.status === 401) {
        throw new Error("Invalid Gupshup API key");
      } else if (error.response.status === 400) {
        throw new Error(`Bad request: ${error.response.data?.message || 'Invalid parameters'}`);
      } else if (error.response.status === 429) {
        throw new Error("Rate limit exceeded on Gupshup API");
      }
    } else if (error.request) {
      console.error("No response received:", error.request);
      throw new Error("No response from Gupshup API");
    }
    
    throw new Error(`Failed to send OTP via Gupshup: ${error.message}`);
  }
};

// Health check
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

// Send OTP
app.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    
    console.log(`📞 OTP request received for phone: ${phone}`);
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: "Phone number is required" 
      });
    }
    
    if (!validatePhoneNumber(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid Indian phone number format" 
      });
    }
    
    if (!checkRateLimit(phone)) {
      return res.status(429).json({ 
        success: false, 
        message: "Too many OTP requests. Try after 1 hour." 
      });
    }

    const otp = generateOTP();
    const expiresAt = Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000;

    // Store OTP
    otpStore.set(phone, { 
      otp, 
      expiresAt, 
      attempts: 0, 
      createdAt: Date.now() 
    });

    console.log(`🔐 Generated OTP for ${phone}: ${otp}`);

    // Send OTP via WhatsApp
    const sendResult = await sendWhatsAppOtpGupshup(phone, otp);
    
    console.log(`✅ OTP sending result:`, sendResult);

    res.json({
      success: true,
      message: "OTP sent successfully via WhatsApp",
      expiresIn: Math.floor((expiresAt - Date.now()) / 1000),
      messageId: sendResult.messageId,
      status: sendResult.status
    });

  } catch (error) {
    console.error("❌ Error in /send-otp:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to send OTP",
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
  try {
    const { phone, otp } = req.body;
    
    console.log(`🔍 OTP verification request for phone: ${phone}, OTP: ${otp}`);
    
    if (!phone || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: "Phone and OTP required" 
      });
    }
    
    if (!validatePhoneNumber(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid phone number" 
      });
    }

    const stored = otpStore.get(phone);
    if (!stored) {
      return res.status(400).json({ 
        success: false, 
        message: "No OTP found. Request a new one." 
      });
    }
    
    if (stored.expiresAt < Date.now()) {
      otpStore.delete(phone);
      return res.status(400).json({ 
        success: false, 
        message: "OTP expired. Request again." 
      });
    }

    if (stored.attempts >= 3) {
      otpStore.delete(phone);
      return res.status(400).json({ 
        success: false, 
        message: "Too many attempts. Request again." 
      });
    }

    if (stored.otp !== otp.toString()) {
      stored.attempts += 1;
      otpStore.set(phone, stored);
      return res.status(400).json({ 
        success: false, 
        message: `Invalid OTP. ${3 - stored.attempts} attempts left.` 
      });
    }

    console.log(`✅ OTP verified successfully for ${phone}`);
    otpStore.delete(phone);
    res.json({ 
      success: true, 
      message: "OTP verified successfully" 
    });

  } catch (error) {
    console.error("❌ Error in /verify-otp:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error" 
    });
  }
});

// Resend OTP
app.post("/resend-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    
    console.log(`🔄 OTP resend request for phone: ${phone}`);
    
    if (!phone || !validatePhoneNumber(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: "Valid phone number required" 
      });
    }

    if (!checkRateLimit(phone)) {
      return res.status(429).json({ 
        success: false, 
        message: "Rate limit exceeded. Try later." 
      });
    }

    const otp = generateOTP();
    const expiresAt = Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000;

    otpStore.set(phone, { 
      otp, 
      expiresAt, 
      attempts: 0, 
      createdAt: Date.now() 
    });

    console.log(`🔐 Resent OTP for ${phone}: ${otp}`);

    const sendResult = await sendWhatsAppOtpGupshup(phone, otp);

    res.json({ 
      success: true, 
      message: "OTP resent successfully",
      messageId: sendResult.messageId,
      status: sendResult.status
    });

  } catch (error) {
    console.error("❌ Error in /resend-otp:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to resend OTP" 
    });
  }
});

// Test endpoint to check Gupshup connectivity
app.post("/test-gupshup", async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || !validatePhoneNumber(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: "Valid phone number required" 
      });
    }

    const testOtp = "123456";
    const result = await sendWhatsAppOtpGupshup(phone, testOtp);
    
    res.json({
      success: true,
      message: "Test OTP sent successfully",
      result: result
    });

  } catch (error) {
    console.error("❌ Test endpoint error:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error("❌ Unhandled error:", error);
  res.status(500).json({ 
    success: false, 
    message: "Internal server error" 
  });
});

app.use("*", (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: "Endpoint not found" 
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Exiting...');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 Gupshup API Key: ${process.env.GUPSHUP_API_KEY ? 'Present' : 'Missing'}`);
  console.log(`📞 Gupshup Sender: ${process.env.GUPSHUP_SENDER || 'Not set'}`);
  console.log(`📝 Template Name: ${process.env.GUPSHUP_TEMPLATE_NAME || 'otp_verification_code'}`);
});