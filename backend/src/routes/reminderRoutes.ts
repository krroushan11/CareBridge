import { Router } from "express";
import { getUpcomingReminders } from "../controllers/reminderController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

router.get("/upcoming", authenticateToken, getUpcomingReminders);

export default router;
