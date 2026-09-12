import { Router } from "express";
import { confirmDocumentAnalysis } from "../controllers/analysisController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

router.post("/:id/confirm", authenticateToken, confirmDocumentAnalysis);

export default router;
