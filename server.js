const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
// We use native 'fetch' (Node 18+) to talk to Brevo API

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= CONFIGURATION =================
// 1. Enter your Name/Email (Sender)
const SENDER_EMAIL = "haripragash714@gmail.com"; 
const SENDER_NAME = "Smart Accident System";

// 2. ⚠️ PASTE YOUR BREVO API KEY HERE (starts with xkeysib...)
const BREVO_API_KEY = "process.env.BREVO_API_KEY"; 

// ================= GLOBAL VARIABLES =================
let lastEmailSentTime = 0; 

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    if (!frame) return false;
    const { ax, ay, az, gx, gy, gz } = frame;
    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);
    // Thresholds
    return (gForce > 3.2 && rotation > 3.5);
}

// ================= HELPER: SEND EMAIL VIA BREVO API =================
async function sendEmailViaBrevo(userEmail, mapLink) {
    const url = "https://api.brevo.com/v3/smtp/email";
    
    const body = {
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: userEmail }], // 👈 THIS SENDS TO THE DYNAMIC USER
        subject: "🚨 Accident Detected! Help Needed!",
        htmlContent: `
            <h2>🚨 EMERGENCY ALERT!</h2>
            <p>An accident has been detected for user: <b>${userEmail}</b></p>
            <p>📍 <a href="${mapLink}">CLICK TO TRACK LOCATION</a></p>
            <p>Time: ${new Date().toLocaleString()}</p>
        `
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json",
                "api-key": BREVO_API_KEY,
                "content-type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            console.log("✅ EMAIL SENT VIA BREVO to:", userEmail);
            return true;
        } else {
            const err = await response.json();
            console.error("❌ BREVO ERROR:", err);
            return false;
        }
    } catch (error) {
        console.error("❌ NETWORK ERROR:", error.message);
        return false;
    }
}

// ================= API ROUTES =================
app.get("/", (req, res) => {
    res.json({ message: "Backend Live (Brevo Mode)", version: "6.0" });
});

app.post("/sensor", async (req, res) => {
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
            console.log("⚠️ Accident detected, but email SKIPPED (Cooldown)");
            return res.json({ crash: true, message: "Skipped (cooldown)" });
        }

        console.log(`🚨 CRASH DETECTED! Sending to user: ${email}`);
        lastEmailSentTime = currentTime;

        const mapLink = location
            ? `http://googleusercontent.com/maps.google.com/maps?q=${location.lat},${location.lng}`
            : "Location not available";

        // Send using Brevo
        sendEmailViaBrevo(email, mapLink);
    }

    res.json({ crash });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
