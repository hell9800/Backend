// server.js - Backend API for data deletion
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch((error) => console.error('MongoDB connection error:', error));

// User Schema (adjust based on your actual user schema)
const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    // Add other fields as per your user schema
    name: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    // Add any other user data fields you have
}, {
    timestamps: true
});

const User = mongoose.model('User', userSchema);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Delete user endpoint
app.post('/api/delete-user', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Find user by email
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not registered yet in our system'
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Delete user and all associated data
        await User.findByIdAndDelete(user._id);

        // If you have other collections with user data, delete them too
        // Example:
        // await UserProfile.deleteMany({ userId: user._id });
        // await UserPosts.deleteMany({ userId: user._id });
        // await UserComments.deleteMany({ userId: user._id });

        console.log(`User deleted: ${email} at ${new Date().toISOString()}`);

        res.json({
            success: true,
            message: 'All user data has been successfully deleted'
        });

    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error occurred'
        });
    }
});

// Alternative endpoint if passwords are stored as plain text (NOT RECOMMENDED)
app.post('/api/delete-user-plaintext', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Find user with email and plain text password (NOT SECURE)
        const user = await User.findOne({ 
            email: email.toLowerCase(),
            password: password 
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not registered yet in our system'
            });
        }

        // Delete user
        await User.findByIdAndDelete(user._id);

        console.log(`User deleted: ${email} at ${new Date().toISOString()}`);

        res.json({
            success: true,
            message: 'All user data has been successfully deleted'
        });

    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error occurred'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});