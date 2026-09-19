import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./config/database";
import analysisRoutes from "./routes/analysisRoutes";
import authRoutes from "./routes/authRoutes";
import documentRoutes from "./routes/documentRoutes";
import followUpRoutes from "./routes/followUpRoutes";
import medicalTestRoutes from "./routes/medicalTestRoutes";
import medicationRoutes from "./routes/medicationRoutes";
import reminderRoutes from "./routes/reminderRoutes";
import { validateJwtSecret } from "./middlewares/authMiddleware";
import { startDocumentProcessingWorker } from "./services/documentProcessingQueue";
import notificationRoutes from "./routes/notificationRoutes";
import { startReminderScheduler } from "./services/reminderEngine";
import caregiverRoutes from "./routes/caregiverRoutes";
import chatRoutes from "./routes/chatRoutes";

dotenv.config();

try {
  validateJwtSecret();
} catch (error) {
  console.error("Authentication configuration error");
  process.exit(1);
}

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
}));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/medications", medicationRoutes);
app.use("/api/follow-ups", followUpRoutes);
app.use("/api/medical-tests", medicalTestRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/caregivers", caregiverRoutes);
app.use("/api/chat", chatRoutes);

startDocumentProcessingWorker();
startReminderScheduler();

const PORT = process.env.PORT || 5000;

// Test API
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      message: "CareBridge AI Backend + Database Connected 🚀",
      databaseTime: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database Error:", error);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 CareBridge AI Server running on port ${PORT}`);
});
