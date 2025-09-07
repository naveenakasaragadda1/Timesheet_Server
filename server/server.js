const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());

// CORS setup
const corsOptions = {
  origin: "https://timesheetspropt.netlify.app", // frontend URL
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/timesheets', require('./routes/timesheets'));
app.use('/api/admin', require('./routes/admin'));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error("❌ MongoDB connection error:", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
