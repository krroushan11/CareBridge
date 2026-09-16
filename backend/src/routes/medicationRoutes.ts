import { Router } from "express";
import {
  createMedication,
  listMedications,
  markMedicationSkipped,
  markMedicationTaken,
} from "../controllers/medicationController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

router.get("/", authenticateToken, listMedications);
router.post("/", authenticateToken, createMedication);
router.post("/:id/taken", authenticateToken, markMedicationTaken);
router.post("/:id/skipped", authenticateToken, markMedicationSkipped);

export default router;
