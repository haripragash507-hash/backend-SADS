const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= CONFIGURATION =================
// ⚠️ IMPORTANT: Use your 16-character App Password here
const EMAIL = "haripragash714@gmail.com";
const PASSWORD = "vgmttqixszleymkv"; 

// FIX: Switched to Port 587 to fix "Connection Timeout"
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // Must be false for port 587 (STARTTLS)
    auth: {
        user: EMAIL,
        pass: PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    }
});

// ================= GLOBAL VARIABLES =================
// Timer to prevent spamming emails (Cooldown)
let lastEmailSentTime = 0; 

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    if (!frame) return false;

    const { ax, ay, az, gx, gy, gz } = frame;

    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);

    // ⚠️ ADJUST THRESHOLDS HERE FOR TESTING
    const highImpact = gForce > 3.2;
    const violentRotation = rotation > 3.5;

    return highImpact && violentRotation;
}

// ================= API ROUTES =================
app.get("/", (req, res) => {
    res.json({ message: "Smart Accident Backend is Live", version: "2.2.0 (Port 587)" });
});

app.post("/sensor", (req, res) => {
    // Heartbeat Log
    console.log("📡 DATA RECEIVED FROM ANDROID");

    // 1. INPUT VALIDATION
    const { sensor, email, location } = req.body;

    if (!sensor || !email) {
        return res.status(400).json({ error: "sensor and email required" });
    }

    // 2. DETECT CRASH
    const crash = detectCrash(sensor);

    if (crash) {
        // 3. COOLDOWN CHECK
        const currentTime = Date.now();
        const cooldownTime = 60 * 1000; // 60 seconds

        if (currentTime - lastEmailSentTime < cooldownTime) {
            console.log("⚠️ Accident detected, but email SKIPPED (Cooldown active)");
            return res.json({ crash: true, message: "Email skipped (cooldown)" });
        }

        // 4. PREPARE EMAIL
        console.log(`🚨 ACCIDENT DETECTED for: ${email}. Sending email...`);
        
        lastEmailSentTime = currentTime;

        const mapLink = location
            ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
            : "Location not available";

        const mailOptions = {
            from: `"Smart Accident System" <${EMAIL}>`,
            to: email,
            subject: "🚨 Accident Detected! Help Needed!",
            text: `EMERGENCY ALERT!\n\nUser: ${email}\nLocation: ${mapLink}\nTime: ${new Date().toLocaleString()}`
        };

        // 5. SEND EMAIL
        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error("❌ EMAIL FAILED:", err.message);
            } else {
                console.log("✅ EMAIL SENT SUCCESSFULLY");
            }
        });
    }

    // 6. IMMEDIATE RESPONSE TO APP
    res.json({ crash });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
