import { Router } from "express";
import {
    confirmDocumentAnalysis,
    getVerificationAuditHistory,
    getVerificationReview,
    getVerificationVersions,
    getVerifiedCarePlan,
    listClinicianReviews,
    saveVerificationEdits,
    submitClinicianReview,
    updateClinicianReview,
} from "../controllers/analysisController";
import { authenticateToken, requireRole } from "../middlewares/authMiddleware";

const router = Router();

router.post("/:id/confirm", authenticateToken, confirmDocumentAnalysis);
router.get("/:id/verified-care-plan", authenticateToken, getVerifiedCarePlan);
router.get("/:documentId/verified-care-plan/versions", authenticateToken, getVerificationVersions);
router.get("/:documentId/verified-care-plan/history", authenticateToken, getVerificationAuditHistory);
router.get("/:id/review", authenticateToken, getVerificationReview);
router.put("/:id/review", authenticateToken, saveVerificationEdits);
router.get("/:id/versions", authenticateToken, getVerificationVersions);
router.get("/:id/audit", authenticateToken, getVerificationAuditHistory);
router.post("/:id/clinician-review", authenticateToken, submitClinicianReview);
router.get("/clinician/reviews", authenticateToken, requireRole("doctor"), listClinicianReviews);
router.patch(
  "/clinician/reviews/:reviewId",
  authenticateToken,
  requireRole("doctor"),
  updateClinicianReview
);

export default router;
