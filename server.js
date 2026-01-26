const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= CONFIGURATION =================
const SENDER_EMAIL = "haripragash714@gmail.com"; 
const SENDER_NAME = "Smart Accident System";
const BREVO_API_KEY = process.env.BREVO_API_KEY; 

// Storage for tracking user activity
const userLastSeen = {}; 
const INACTIVITY_LIMIT_MS = 60000; // 1 minute
const COOLDOWN_MS = 30000; 

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    if (!frame) return false;
    const { ax, ay, az, gx, gy, gz } = frame;
    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);
    return (gForce > 3.2 && rotation > 3.5);
}

// ================= HELPER: SEND EMAIL =================
async function sendEmailViaBrevo(userEmail, mapLink, isDisconnect = false) {
    const url = "https://api.brevo.com/v3/smtp/email";
    
    const subject = isDisconnect 
        ? "⚠️ Alert: Device Connection Lost!" 
        : "🚨 Accident Detected! Help Needed!";
    
    const messageHtml = isDisconnect
        ? `<h2>⚠️ CONNECTION LOST</h2>
           <p>The device for <b>${userEmail}</b> has stopped sending data for over 1 minute.</p>
           <p>📍 Last known location: <a href="${mapLink}">View on Map</a></p>`
        : `<h2>🚨 EMERGENCY ALERT!</h2>
           <p>An accident has been detected for user: <b>${userEmail}</b></p>
           <p>📍 <a href="${mapLink}">CLICK TO TRACK LOCATION</a></p>`;

    const body = {
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: userEmail }],
        subject: subject,
        htmlContent: messageHtml
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
        return response.ok;
    } catch (error) {
        console.error("❌ EMAIL ERROR:", error.message);
        return false;
    }
}

// ================= INACTIVITY CHECKER =================
// This runs every 30 seconds to check if any user has "disappeared"
setInterval(() => {
    const now = Date.now();
    for (const email in userLastSeen) {
        const userData = userLastSeen[email];

        // If user was active before, but now hasn't sent data for 1 minute
        if (!userData.alertSent && (now - userData.timestamp > INACTIVITY_LIMIT_MS)) {
            console.log(`⚠️ User ${email} went offline. Sending alert...`);
            
            sendEmailViaBrevo(email, userData.lastMapLink, true);
            
            // Mark as alert sent so we don't spam emails every 30 seconds
            userData.alertSent = true; 
        }
    }
}, 30000);

// ================= API ROUTES =================
app.post("/sensor", async (req, res) => {
    console.log("📡 DATA RECEIVED FROM ANDROID");

    const { sensor, email, location } = req.body;
    if (!sensor || !email) return res.status(400).json({ error: "Missing data" });

    const currentTime = Date.now();
    // ✅ CORRECT
            const mapLink = location && location.lat && location.lng
                ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
                : "Location not available";
    
    // 1. UPDATE USER STATUS (Heartbeat)
    userLastSeen[email] = {
        timestamp: currentTime,
        lastMapLink: mapLink,
        alertSent: false // Reset alert status because they are back online
    };

    // 2. CRASH DETECTION
    const crash = detectCrash(sensor);
    // Use a user-specific cooldown for crashes
    if (crash && (currentTime - (userLastSeen[email].lastCrashTime || 0) > COOLDOWN_MS)) {
        userLastSeen[email].lastCrashTime = currentTime;
        console.log(`🚨 CRASH DETECTED ! Sending to user: ${email}`);
        sendEmailViaBrevo(email, mapLink);
    }

    res.json({ crash });
});

app.get("/", (req, res) => {
    res.json({ message: "Backend Live with Inactivity Monitor", activeUsers: Object.keys(userLastSeen).length });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
