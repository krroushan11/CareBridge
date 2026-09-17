import { Router } from "express";
import {
  completeMedicalTest,
  createMedicalTest,
  deleteMedicalTest,
  getMedicalTest,
  getMedicalTestReminders,
  listMedicalTests,
  updateMedicalTest,
} from "../controllers/medicalTestController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

router.get("/", authenticateToken, listMedicalTests);
router.get("/reminders/upcoming", authenticateToken, getMedicalTestReminders);
router.get("/:id", authenticateToken, getMedicalTest);
router.post("/", authenticateToken, createMedicalTest);
router.post("/:id/complete", authenticateToken, completeMedicalTest);
router.patch("/:id", authenticateToken, updateMedicalTest);
router.delete("/:id", authenticateToken, deleteMedicalTest);

export default router;
