const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= CONFIGURATION =================
const EMAIL = "haripragash714@gmail.com";
const PASSWORD = "vgmttqixszleymkv"; 

// FIX: Force IPv4 to prevent hanging on Render
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, 
    auth: {
        user: EMAIL,
        pass: PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    },
    // ⚠️ CRITICAL FIX: Force IPv4 (Fixes the hang after "Resolved...")
    family: 4, 
    logger: true,
    debug: true,
    connectionTimeout: 10000 
});

// ================= GLOBAL VARIABLES =================
let lastEmailSentTime = 0; 

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    if (!frame) return false;

    const { ax, ay, az, gx, gy, gz } = frame;

    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);

    const highImpact = gForce > 3.2;
    const violentRotation = rotation > 3.5;

    return highImpact && violentRotation;
}

// ================= API ROUTES =================
app.get("/", (req, res) => {
    res.json({ message: "Smart Accident Backend is Live", version: "5.0.0 (IPv4 Fix)" });
});

app.post("/sensor", (req, res) => {
    console.log("📡 DATA RECEIVED FROM ANDROID");

    const { sensor, email, location } = req.body;

    if (!sensor || !email) {
        return res.status(400).json({ error: "sensor and email required" });
    }

    const crash = detectCrash(sensor);

    if (crash) {
        const currentTime = Date.now();
        const cooldownTime = 60 * 1000; 

        if (currentTime - lastEmailSentTime < cooldownTime) {
            console.log("⚠️ Accident detected, but email SKIPPED (Cooldown active)");
            return res.json({ crash: true, message: "Email skipped (cooldown)" });
        }

        console.log(`🚨 ACCIDENT DETECTED for: ${email}. Sending email...`);
        lastEmailSentTime = currentTime;

        // Map Link
        const mapLink = location
            ? `http://googleusercontent.com/maps.google.com/maps?q=${location.lat},${location.lng}`
            : "Location not available";

        const mailOptions = {
            from: `"Smart Accident System" <${EMAIL}>`,
            to: email,
            subject: "🚨 Accident Detected! Help Needed!",
            text: `EMERGENCY ALERT!\n\nUser: ${email}\nLocation: ${mapLink}\nTime: ${new Date().toLocaleString()}`
        };

        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error("❌ EMAIL FAILED:", err.message);
            } else {
                console.log("✅ EMAIL SENT SUCCESSFULLY");
            }
        });
    }

    res.json({ crash });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
