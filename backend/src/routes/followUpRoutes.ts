import { Router } from "express";
import {
  completeFollowUp,
  createFollowUp,
  deleteFollowUp,
  getFollowUp,
  getFollowUpReminders,
  listFollowUps,
  updateFollowUp,
} from "../controllers/followUpController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

router.get("/", authenticateToken, listFollowUps);
router.get("/reminders/upcoming", authenticateToken, getFollowUpReminders);
router.get("/:id", authenticateToken, getFollowUp);
router.post("/", authenticateToken, createFollowUp);
router.post("/:id/complete", authenticateToken, completeFollowUp);
router.patch("/:id", authenticateToken, updateFollowUp);
router.delete("/:id", authenticateToken, deleteFollowUp);

export default router;
