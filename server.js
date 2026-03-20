const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();

const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= MONGODB SETUP =================
const MONGO_URL = process.env.MONGO_URL;

const client = new MongoClient(MONGO_URL);

let db;
let sensorCollection;
let usersCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log("✅ MongoDB Connected");

        db = client.db("smart_accident_db");
        sensorCollection = db.collection("sensor_logs");
        usersCollection = db.collection("users");

    } catch (err) {
        console.error("❌ MongoDB Error:", err);
    }
}
connectDB();

// ================= CONFIGURATION =================
const SENDER_EMAIL = "haripragash714@gmail.com"; 
const SENDER_NAME = "Smart Accident System";
const BREVO_API_KEY = process.env.BREVO_API_KEY; 
const JWT_SECRET = process.env.JWT_SECRET;

const userLastSeen = {}; 
const pendingAlerts = {}; 
const GRACE_PERIOD_MS = 60000;
const INACTIVITY_LIMIT_MS = 60000;
const GLOBAL_EMAIL_COOLDOWN_MS = 60000;
const CRASH_COOLDOWN_MS = 30000;

// ================= AUTH MIDDLEWARE =================
function authMiddleware(req, res, next) {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
}

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    if (!frame) return false;
    const { ax, ay, az, gx, gy, gz } = frame;
    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);
    return (gForce > 3.2 && rotation > 3.5);
}

// ================= EMAIL FUNCTION =================
async function sendEmailViaBrevo(userEmail, mapLink, isDisconnect = false) {
    const now = Date.now();
    const userData = userLastSeen[userEmail];

    if (userData && userData.lastEmailTime && (now - userData.lastEmailTime < GLOBAL_EMAIL_COOLDOWN_MS)) {
        console.log(`⏳ Cooldown active for ${userEmail}`);
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
            console.log(`✅ Email sent to ${userEmail}`);
            return true;
        }
    } catch (error) {
        console.error("❌ Email failed:", error.message);
    }
    return false;
}

// ================= INACTIVITY WATCHDOG =================
setInterval(() => {
    const now = Date.now();
    for (const email in userLastSeen) {
        const userData = userLastSeen[email];

        if (!userData.alertSent && (now - userData.timestamp > INACTIVITY_LIMIT_MS)) {
            console.log(`⚠️ ${email} offline`);
            sendEmailViaBrevo(email, userData.lastMapLink, true).then(sent => {
                if (sent) userData.alertSent = true;
            });
        }
    }
}, 30000);

// ================= AUTH ROUTES =================

// REGISTER
app.post("/register", async (req, res) => {
    const { email, password } = req.body;

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
        return res.status(400).json({ error: "User exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await usersCollection.insertOne({
        email,
        password: hashedPassword,
        createdAt: new Date()
    });

    res.json({ message: "Registered successfully" });
});

// LOGIN
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });

    res.json({ token });
});

// ================= EXISTING ROUTES =================

// CANCEL ALERT
app.post("/cancel", (req, res) => {
    const { email } = req.body;
    if (pendingAlerts[email]) {
        clearTimeout(pendingAlerts[email]);
        delete pendingAlerts[email];
        return res.json({ status: "cancelled" });
    }
    res.status(404).json({ error: "No active alert" });
});

// SENSOR (NOW PROTECTED + STORES DATA)
app.post("/sensor", authMiddleware, async (req, res) => {
    console.log("📡 DATA RECEIVED");

    const { sensor, location } = req.body;
    const email = req.user.email;

    if (!sensor) return res.status(400).json({ error: "Missing data" });

    const currentTime = Date.now();

    const mapLink = location && location.lat && location.lng
        ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
        : "https://maps.google.com";

    if (!userLastSeen[email]) {
        userLastSeen[email] = { lastEmailTime: 0, lastCrashTime: 0 };
    }

    userLastSeen[email].timestamp = currentTime;
    userLastSeen[email].lastMapLink = mapLink;
    userLastSeen[email].alertSent = false;

    const crash = detectCrash(sensor);

    // 🔥 STORE IN MONGODB
    await sensorCollection.insertOne({
        email,
        sensor,
        location,
        mapLink,
        crashDetected: crash,
        timestamp: new Date()
    });

    if (crash && (currentTime - userLastSeen[email].lastCrashTime > CRASH_COOLDOWN_MS)) {
        userLastSeen[email].lastCrashTime = currentTime;

        pendingAlerts[email] = setTimeout(() => {
            sendEmailViaBrevo(email, mapLink);
            delete pendingAlerts[email];
        }, GRACE_PERIOD_MS);
    }

    res.json({ crash });
});

// ROOT
app.get("/", (req, res) => {
    res.json({
        message: "Backend Active with MongoDB + Auth",
        users: Object.keys(userLastSeen).length
    });
});

// ================= SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
