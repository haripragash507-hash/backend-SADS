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

const userLastSeen = {}; 
const pendingAlerts = {}; // Tracks active countdowns for cancellation
const GRACE_PERIOD_MS = 60000; // CHANGED: Now 1 minute (60,000 milliseconds)
const INACTIVITY_LIMIT_MS = 60000; 
const GLOBAL_EMAIL_COOLDOWN_MS = 60000; 
const CRASH_COOLDOWN_MS = 30000; 

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
    const now = Date.now();
    const userData = userLastSeen[userEmail];

    if (userData && userData.lastEmailTime && (now - userData.lastEmailTime < GLOBAL_EMAIL_COOLDOWN_MS)) {
        console.log(`⏳ Cooldown active for ${userEmail}. Skipping email.`);
        return false;
    }

    const url = "https://api.brevo.com/v3/smtp/email";
    const subject = isDisconnect ? "⚠️ Alert: Connection Lost!" : "🚨 Accident Detected!";
    const messageHtml = isDisconnect
        ? `<h2>⚠️ CONNECTION LOST</h2><p>Device for <b>${userEmail}</b> stopped sending data.</p><p>📍 <a href="${mapLink}">Last Known Location</a></p>`
        : `<h2>🚨 EMERGENCY ALERT!</h2><p>Accident detected for: <b>${userEmail}</b></p><p>📍 <a href="${mapLink}">Track Location</a></p>`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json",
                "api-key": BREVO_API_KEY,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                sender: { name: SENDER_NAME, email: SENDER_EMAIL },
                to: [{ email: userEmail }],
                subject: subject,
                htmlContent: messageHtml
            })
        });

        if (response.ok) {
            if (userLastSeen[userEmail]) userLastSeen[userEmail].lastEmailTime = now;
            console.log(`✅ Email sent to ${userEmail} (${isDisconnect ? 'Disconnect' : 'Crash'})`);
            return true;
        }
    } catch (error) {
        console.error("❌ Email failed:", error.message);
    }
    return false;
}

// ================= INACTIVITY CHECKER (WATCHDOG) =================
setInterval(() => {
    const now = Date.now();
    for (const email in userLastSeen) {
        const userData = userLastSeen[email];
        
        if (!userData.alertSent && (now - userData.timestamp > INACTIVITY_LIMIT_MS)) {
            console.log(`⚠️ User ${email} went offline. Sending alert...`);
            sendEmailViaBrevo(email, userData.lastMapLink, true).then(sent => {
                if (sent) userData.alertSent = true;
            });
        }
    }
}, 30000);

// ================= API ROUTES =================

app.post("/cancel", (req, res) => {
    const { email } = req.body;
    if (pendingAlerts[email]) {
        console.log(`🛑 User ${email} clicked CANCEL. Aborting crash email.`);
        clearTimeout(pendingAlerts[email]); 
        delete pendingAlerts[email];
        return res.json({ status: "cancelled" });
    }
    res.status(404).json({ error: "No active alert to cancel" });
});

app.post("/sensor", async (req, res) => {
    console.log("📡 DATA RECEIVED FROM ANDROID");

    const { sensor, email, location } = req.body;
    if (!sensor || !email) return res.status(400).json({ error: "Missing data" });

    const currentTime = Date.now();
    const mapLink = location && location.lat && location.lng
        ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
        : "Location not available";

    if (!userLastSeen[email]) {
        userLastSeen[email] = { lastEmailTime: 0, lastCrashTime: 0 };
    }

    userLastSeen[email].timestamp = currentTime;
    userLastSeen[email].lastMapLink = mapLink;
    userLastSeen[email].alertSent = false; 

    const crash = detectCrash(sensor);
    if (crash && (currentTime - userLastSeen[email].lastCrashTime > CRASH_COOLDOWN_MS)) {
        userLastSeen[email].lastCrashTime = currentTime;
        
        // This console log will now automatically show "60s grace period"
        console.log(`🚨 CRASH DETECTED! Waiting ${GRACE_PERIOD_MS/1000}s grace period for ${email}...`);

        pendingAlerts[email] = setTimeout(() => {
            console.log(`⏰ Grace period over. Sending crash email for ${email}`);
            sendEmailViaBrevo(email, mapLink);
            delete pendingAlerts[email];
        }, GRACE_PERIOD_MS);
    }

    res.json({ crash });
});

app.get("/", (req, res) => {
    res.json({ 
        message: "Backend Active with 1 Minute Grace Period & Inactivity Watchdog", 
        activeUsersCount: Object.keys(userLastSeen).length 
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
