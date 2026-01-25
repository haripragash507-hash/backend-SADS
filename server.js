const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= CONFIG =================
// ⚠️ Ensure 'Less Secure Apps' is on or use an App Password
const EMAIL = "haripragash714@gmail.com";
const PASSWORD = "vgmttqixszleymkv"; 

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: EMAIL,
        pass: PASSWORD
    }
});

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    // Safety check: ensure frame exists
    if (!frame) return false;

    const { ax, ay, az, gx, gy, gz } = frame;

    // Calculate magnitude
    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);

    // Thresholds
    const highImpact = gForce > 3.2;
    const violentRotation = rotation > 3.5;

    return highImpact && violentRotation;
}

// ================= API =================
app.get("/", (req, res) => {
    res.json({ message: "Smart Accident Backend is running", version: "1.0.0" });
});

app.post("/sensor", async (req, res) => {
    console.log("📡 DATA RECEIVED FROM ANDROID");

    const { sensor, email, location } = req.body;

    // 1. Validate Input
    if (!sensor || !email) {
        console.log("❌ Missing sensor data or email");
        return res.status(400).json({ error: "sensor and email required" });
    }

    // 2. Detect Crash
    const crash = detectCrash(sensor);

    if (crash) {
        console.log("🚨 ACCIDENT DETECTED for:", email);

        // FIX: Corrected Google Maps URL format
        const mapLink = location
            ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
            : "Location not available";

        const mailOptions = {
            from: `"Smart Accident System" <${EMAIL}>`,
            to: email,
            subject: "🚨 Accident Detected",
            text: `ACCIDENT DETECTED!\n\nUser Email: ${email}\n\nLive location:\n${mapLink}`
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log("✅ Email sent successfully");
        } catch (err) {
            console.error("❌ Email error:", err);
        }
    } else {
        // Optional: Log normal data just to see flow (can remove later to reduce noise)
        // console.log("Normal data processing...");
    }

    // Always respond so Android knows we got it
    res.json({ crash, message: "Data received" });
});

// ================= START =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
