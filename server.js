const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= CONFIG =================
// ⚠️ Use App Password (not normal Gmail password)
const EMAIL = "haripragash714@gmail.com";
const PASSWORD = "qyhqtostpatvqlnu";

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: EMAIL,
        pass: PASSWORD
    }
});

// ================= CRASH LOGIC =================
function detectCrash(frame) {
    const { ax, ay, az, gx, gy, gz } = frame;

    const gForce = Math.sqrt(ax*ax + ay*ay + az*az) / 9.81;
    const rotation = Math.sqrt(gx*gx + gy*gy + gz*gz);

    const highImpact = gForce > 3.2;
    const violentRotation = rotation > 3.5;

    return highImpact && violentRotation;
}

// ================= API =================
app.get("/", (req, res) => {
    res.json({ message: "Smart Accident Backend is running", version: "1.0.0" });
});

app.post("/sensor", async (req, res) => {

    console.log("📡 DATA RECEIVED FROM ANDROID:");
    console.log(JSON.stringify(req.body, null, 2));

    const { sensor, email, location } = req.body;

    if (!sensor || !email) {
        return res.status(400).json({ error: "sensor and email required" });
    }

    const crash = detectCrash(sensor);

    if (crash) {
        console.log("🚨 ACCIDENT DETECTED");

        const mapLink = location
            ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
            : "Location not available";

        const mailOptions = {
            from: `"Smart Accident System" <${EMAIL}>`,
            to: email,
            subject: "🚨 Accident Detected",
            text: `ACCIDENT DETECTED!\n\nLive location:\n${mapLink}`
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log("✅ Email sent instantly");
        } catch (err) {
            console.error("❌ Email error:", err);
        }
    }

    res.json({ crash });
});

// ================= START =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

