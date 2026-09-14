import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import { pool } from "./config/database";
import analysisRoutes from "./routes/analysisRoutes";
import authRoutes from "./routes/authRoutes";
import documentRoutes from "./routes/documentRoutes";
import { validateJwtSecret } from "./middlewares/authMiddleware";
import { startDocumentProcessingWorker } from "./services/documentProcessingQueue";

dotenv.config();

try {
  validateJwtSecret();
} catch (error) {
  console.error("Authentication configuration error");
  process.exit(1);
}

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/analysis", analysisRoutes);

startDocumentProcessingWorker();

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
