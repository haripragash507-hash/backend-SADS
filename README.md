
# 🚨 Smart Accident Backend (Node.js)

## 🔥 Features
- Receives sensor data from Android app
- Detects crash in backend
- Sends FAST email using Nodemailer
- Google Maps live location link

---

## ✅ Requirements
- Node.js installed
- Gmail App Password enabled

---

## ▶ Run Backend

```bash
cd smart_accident_backend_node
npm install
npm start
```

Server runs at:
http://localhost:5000

---

## 📡 API Endpoint

POST /sensor

Example JSON:

{
  "email": "target@gmail.com",
  "sensor": {
    "ax": 12.4,
    "ay": 4.2,
    "az": 30.1,
    "gx": 3.1,
    "gy": 1.9,
    "gz": 2.2
  },
  "location": {
    "lat": 11.0123,
    "lng": 77.0123
  }
}

---

## ⚠️ Important

Edit server.js:

const EMAIL = "YOUR_EMAIL@gmail.com";
const PASSWORD = "YOUR_APP_PASSWORD";

---

## 🔗 Android App Flow

App → sends JSON to backend
Backend → detects crash
Backend → instantly emails user

---

## 🚀 Next Level
Tomorrow we can add:
- Cloud deployment (Railway / Render)
- Real-time dashboard
- Multiple contacts
- SMS alerts

