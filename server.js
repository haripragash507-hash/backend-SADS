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

// Use Secure SMTP (Port 465) to prevent Render timeouts
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: EMAIL,
        pass: PASSWORD
    }
});

// ================= GLOBAL VARIABLES =================
// Timer to prevent spamming emails (Cooldown)
let lastEmailSentTime = 0; 

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    if (!frame) return false;

    const { ax, ay, az, gx, gy, gz } = frame;

    // Calculate magnitude
    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);

    // ⚠️ ADJUST THRESHOLDS HERE FOR TESTING
    const highImpact = gForce > 3.2;
    const violentRotation = rotation > 3.5;

    return highImpact && violentRotation;
}

// ================= API ROUTES =================
app.get("/", (req, res) => {
    res.json({ message: "Smart Accident Backend is Live", version: "2.1.0 (Fixed)" });
});

app.post("/sensor", (req, res) => {
    // 1. INPUT VALIDATION
    const { sensor, email, location } = req.body;

    if (!sensor || !email) {
        return res.status(400).json({ error: "sensor and email required" });
    }

    // 2. DETECT CRASH
    const crash = detectCrash(sensor);

    if (crash) {
        // 3. COOLDOWN CHECK (Prevent Spam)
        const currentTime = Date.now();
        // FIX: Correct math for 1 minute (60 seconds * 1000 ms)
        const cooldownTime = 60 * 1000; 

        // FIX: Changed 'oneMinutes' to 'cooldownTime'
        if (currentTime - lastEmailSentTime < cooldownTime) {
            console.log("⚠️ Accident detected, but email SKIPPED (Cooldown active)");
            return res.json({ crash: true, message: "Email skipped (cooldown)" });
        }

        // 4. PREPARE EMAIL
        console.log(`🚨 ACCIDENT DETECTED for: ${email}. Sending email...`);
        
        // Update the last sent time
        lastEmailSentTime = currentTime;

        // FIX: Corrected Standard Google Maps Link
        const mapLink = location
            ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
            : "Location not available";

        const mailOptions = {
            from: `"Smart Accident System" <${EMAIL}>`,
            to: email,
            subject: "🚨 Accident Detected! Help Needed!",
            text: `EMERGENCY ALERT!\n\nAn accident has been detected for user: ${email}\n\n📍 TRACK LOCATION:\n${mapLink}\n\nTime: ${new Date().toLocaleString()}`
        };

        // 5. SEND EMAIL (Background Process)
        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error("❌ EMAIL FAILED:", err.message);
            } else {
                console.log("✅ EMAIL SENT SUCCESSFULLY:", info.response);
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
