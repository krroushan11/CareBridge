import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import { listNotifications, listUnreadNotifications, markNotificationRead } from "../controllers/notificationController";
import { createPushSubscription, deletePushSubscription } from "../controllers/pushSubscriptionController";

const router = Router();
router.get("/", authenticateToken, listNotifications);
router.get("/unread", authenticateToken, listUnreadNotifications);
router.patch("/:id/read", authenticateToken, markNotificationRead);
router.post("/push-subscriptions", authenticateToken, createPushSubscription);
router.delete("/push-subscriptions/:id", authenticateToken, deletePushSubscription);
export default router;
