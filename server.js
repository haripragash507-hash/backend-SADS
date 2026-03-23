const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ObjectId } = require("mongodb");
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
const SENDER_EMAIL = process.env.SENDER_EMAIL || "haripragash714@gmail.com";
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
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : authHeader;
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
  const gForce = Math.sqrt(ax * ax + ay * ay + az * az) / 9.81;
  const rotation = Math.sqrt(gx * gx + gy * gy + gz * gz);
  return gForce > 3.2 && rotation > 3.5;
}

function computeGForce(sensor) {
  if (!sensor) return 0;
  const { ax = 0, ay = 0, az = 0 } = sensor;
  return Math.sqrt(ax * ax + ay * ay + az * az) / 9.81;
}

function computeRotation(sensor) {
  if (!sensor) return 0;
  const { gx = 0, gy = 0, gz = 0 } = sensor;
  return Math.sqrt(gx * gx + gy * gy + gz * gz);
}

// ================= EMAIL FUNCTION =================
async function sendEmailViaBrevo(userEmail, mapLink, isDisconnect = false) {
  const now = Date.now();
  const userData = userLastSeen[userEmail];
  if (
    userData &&
    userData.lastEmailTime &&
    now - userData.lastEmailTime < GLOBAL_EMAIL_COOLDOWN_MS
  ) {
    console.log(`⏳ Cooldown active for ${userEmail}`);
    return false;
  }

  const url = "https://api.brevo.com/v3/smtp/email";
  const subject = isDisconnect
    ? "⚠️ Alert: Connection Lost!"
    : "🚨 Accident Detected!";
  const messageHtml = isDisconnect
    ? `<h2>⚠️ CONNECTION LOST</h2><p>Device for <b>${userEmail}</b> stopped sending data.</p><p>📍 <a href="${mapLink}">Last Known Location</a></p>`
    : `<h2>🚨 EMERGENCY ALERT!</h2><p>Accident detected for: <b>${userEmail}</b></p><p>📍 <a href="${mapLink}">Track Location</a></p>`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: userEmail }],
        subject,
        htmlContent: messageHtml,
      }),
    });
    if (response.ok) {
      if (userLastSeen[userEmail])
        userLastSeen[userEmail].lastEmailTime = now;
      console.log(`📧 Email sent to ${userEmail}`);
      return true;
    }
    const errText = await response.text();
    console.error("❌ Brevo API error:", errText);
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
    if (!userData.alertSent && now - userData.timestamp > INACTIVITY_LIMIT_MS) {
      const emergencyEmail = userData.emergencyEmail || email;
      console.log(`⚠️ ${email} offline — alerting ${emergencyEmail}`);
      sendEmailViaBrevo(emergencyEmail, userData.lastMapLink, true).then(
        (sent) => {
          if (sent) userData.alertSent = true;
        }
      );
    }
  }
}, 30000);

// ================= AUTH ROUTES =================

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  const existingUser = await usersCollection.findOne({ email });
  if (existingUser) return res.status(400).json({ error: "User exists" });
  const hashedPassword = await bcrypt.hash(password, 10);
  await usersCollection.insertOne({
    email,
    password: hashedPassword,
    emergencyEmail: "",
    emergencyName: "",
    createdAt: new Date(),
  });
  res.json({ message: "Registered successfully" });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  const user = await usersCollection.findOne({ email });
  if (!user) return res.status(400).json({ error: "User not found" });
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ error: "Invalid password" });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, email });
});

app.post("/update-contact", authMiddleware, async (req, res) => {
  const { emergencyName, emergencyEmail } = req.body;
  const email = req.user.email;
  try {
    await usersCollection.updateOne(
      { email },
      { $set: { emergencyName, emergencyEmail } }
    );
    console.log(`✅ Updated contact for ${email}: → ${emergencyEmail}`);
    res.json({ message: "Contact updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Update failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /profile  — return logged-in user's profile (incl. emergency contact)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/profile", authMiddleware, async (req, res) => {
  const email = req.user.email;
  const user = await usersCollection.findOne(
    { email },
    { projection: { password: 0 } }
  );
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /logs  — return sensor logs for the logged-in user (last 200, last 1h)
// Enriches each log with computed gForce, rotation fields for the dashboard.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/logs", authMiddleware, async (req, res) => {
  const email = req.user.email;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  try {
    const logs = await sensorCollection
      .find({ email, timestamp: { $gte: oneHourAgo } })
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();

    // Enrich logs with derived fields the dashboard expects
    const enriched = logs.map((log) => ({
      ...log,
      isCrash: log.crashDetected,
      createdAt: log.timestamp,
      userName: email,
      sensor: {
        ...log.sensor,
        gForce: computeGForce(log.sensor),
        rotation: computeRotation(log.sensor),
        score:
          detectCrash(log.sensor)
            ? 5
            : computeGForce(log.sensor) > 2
            ? 3
            : 0,
      },
    }));

    res.json({ logs: enriched });
  } catch (err) {
    console.error("Logs fetch error:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /cancel/status  — check if there is a pending alert for the current user
// ─────────────────────────────────────────────────────────────────────────────
app.get("/cancel/status", authMiddleware, async (req, res) => {
  const email = req.user.email;
  const hasPending = !!pendingAlerts[email];
  const userData = userLastSeen[email];
  res.json({
    hasPendingAlert: hasPending,
    email,
    mapLink: userData?.lastMapLink || null,
    secondsLeft: hasPending ? GRACE_PERIOD_MS / 1000 : 0,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /cancel  — cancel the pending grace-period alert for a user
// Body: { email }  (the email whose alert should be cancelled)
// ─────────────────────────────────────────────────────────────────────────────
// app.post("/cancel", authMiddleware, async (req, res) => {
//   // Allow cancelling own alert (body.email) or self (token email)
//   const email = req.body.email || req.user.email;
//   if (pendingAlerts[email]) {
//     clearTimeout(pendingAlerts[email]);
//     delete pendingAlerts[email];
//     console.log(`⏸️ Alert cancelled for ${email}`);
//     return res.json({ status: "cancelled", message: "Alert cancelled successfully" });
//   }
//   // No pending alert — still return 200 so dashboard doesn't throw
//   res.json({ status: "no_alert", message: "No active alert found" });
// });

app.post("/cancel", async (req, res) => {
  let email;

  // ✅ If token exists → use auth
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

      const decoded = jwt.verify(token, JWT_SECRET);
      email = decoded.email;
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }
  } else {
    // ✅ fallback for mobile app (old behavior)
    email = req.body.email;
  }

  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  if (pendingAlerts[email]) {
    clearTimeout(pendingAlerts[email]);
    delete pendingAlerts[email];
    console.log(`⏸️ Alert cancelled for ${email}`);
    return res.json({ status: "cancelled" });
  }

  res.json({ status: "no_alert" });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sensor  — receive sensor data from the mobile app
// ─────────────────────────────────────────────────────────────────────────────
app.post("/sensor", authMiddleware, async (req, res) => {
  console.log("📡 DATA RECEIVED");
  const {
    sensor,
    location,
    emergencyEmail: bodyEmail,
    emergencyName: bodyName,
  } = req.body;
  const email = req.user.email;

  if (!sensor) return res.status(400).json({ error: "Missing sensor data" });

  // Fallback sync: update DB if emergency contact sent via heartbeat
  if (bodyEmail || bodyName) {
    await usersCollection.updateOne(
      { email },
      { $set: { emergencyEmail: bodyEmail, emergencyName: bodyName } }
    );
  }

  const user = await usersCollection.findOne({ email });
  if (!user) return res.status(400).json({ error: "User not found" });

  const emergencyEmail = user.emergencyEmail || email;
  const currentTime = Date.now();
  const mapLink =
    location && location.lat && location.lng
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : "https://maps.google.com";

  // Update session tracking
  if (!userLastSeen[email])
    userLastSeen[email] = { lastEmailTime: 0, lastCrashTime: 0 };
  userLastSeen[email].timestamp = currentTime;
  userLastSeen[email].lastMapLink = mapLink;
  userLastSeen[email].alertSent = false;
  userLastSeen[email].emergencyEmail = emergencyEmail;

  const crash = detectCrash(sensor);

  // Store log
  await sensorCollection.insertOne({
    email,
    sensor,
    location,
    mapLink,
    crashDetected: crash,
    timestamp: new Date(),
  });

  if (crash) console.log(`🚨 Crash detected for ${email}`);

  // Crash alert logic (grace period)
  if (
    crash &&
    currentTime - userLastSeen[email].lastCrashTime > CRASH_COOLDOWN_MS
  ) {
    userLastSeen[email].lastCrashTime = currentTime;
    console.log(`⏳ Grace period started for ${email}`);
    pendingAlerts[email] = setTimeout(async () => {
      await sendEmailViaBrevo(emergencyEmail, mapLink);
      delete pendingAlerts[email];
    }, GRACE_PERIOD_MS);
  }

  res.json({ crash });
});

// ROOT
app.get("/", (req, res) => {
  res.json({
    message: "SADS Backend Active",
    users: Object.keys(userLastSeen).length,
    pendingAlerts: Object.keys(pendingAlerts).length,
  });
});

// ================= SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
