import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  acceptCaregiverInvitation,
  getCaregiverPermissions,
  getSharedCarePlan,
  getSharedTasks,
  inviteCaregiver,
  listCaregiverRelationships,
  rejectCaregiverInvitation,
  revokeCaregiverAccess,
  updateCaregiverPermissions,
  updateSharedFollowUp,
  updateSharedMedicalTest,
} from "../controllers/caregiverController";

const router = Router();

router.use(authenticateToken);
router.get("/", listCaregiverRelationships);
router.post("/invite", inviteCaregiver);
router.post("/:id/accept", acceptCaregiverInvitation);
router.post("/:id/reject", rejectCaregiverInvitation);
router.get("/:id/permissions", getCaregiverPermissions);
router.patch("/:id/permissions", updateCaregiverPermissions);
router.post("/:id/revoke", revokeCaregiverAccess);
router.get("/:id/care-plan", getSharedCarePlan);
router.get("/:id/tasks", getSharedTasks);
router.patch("/:id/follow-ups/:taskId", updateSharedFollowUp);
router.patch("/:id/medical-tests/:taskId", updateSharedMedicalTest);

export default router;
