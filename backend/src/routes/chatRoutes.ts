import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateToken } from "../middlewares/authMiddleware";
import { getChatHistory, postChat } from "../controllers/chatController";

const router = Router();
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many chat requests. Please try again later." },
});
router.use(authenticateToken);
router.get("/history", getChatHistory);
router.post("/", chatLimiter, postChat);
export default router;
