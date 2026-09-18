import { Request, Response } from "express";
import { pool } from "../config/database";

const ownerId = (req: Request) => (req as any).user?.id as string | undefined;

export const listNotifications = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    const result = await pool.query(
      `SELECT id, kind, title, body, scheduled_for, status, delivery_status,
              delivery_error, read_at, delivered_at, created_at
       FROM notifications WHERE user_id = $1 ${req.query.unread === "true" ? "AND status = 'unread'" : ""}
       ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    return res.json({ success: true, notifications: result.rows });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve notifications" });
  }
};

export const listUnreadNotifications = async (req: Request, res: Response) => {
  req.query.unread = "true";
  return listNotifications(req, res);
};

export const markNotificationRead = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    const result = await pool.query(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
       updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2
       RETURNING id, status, read_at`,
      [req.params.id, userId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Notification not found" });
    return res.json({ success: true, notification: result.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update notification" });
  }
};
