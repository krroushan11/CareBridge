import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../config/database";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => /^https?:\/\//i.test(value), "Invalid endpoint"),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]+$/, "Invalid p256dh key").max(512),
    auth: z.string().regex(/^[A-Za-z0-9_-]+$/, "Invalid auth key").max(512),
  }).strict(),
}).strict();

const ownerId = (req: Request) => (req as any).user?.id as string | undefined;

export const createPushSubscription = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid push subscription" });

  try {
    const existing = await pool.query("SELECT user_id FROM push_subscriptions WHERE endpoint = $1", [parsed.data.endpoint]);
    if (existing.rows[0] && existing.rows[0].user_id !== userId) {
      return res.status(409).json({ success: false, message: "Push subscription already belongs to another owner" });
    }
    const result = await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, endpoint, p256dh, auth, created_at, updated_at`,
      [userId, parsed.data.endpoint, parsed.data.keys.p256dh, parsed.data.keys.auth]
    );
    return res.status(201).json({ success: true, subscription: result.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to save push subscription" });
  }
};

export const deletePushSubscription = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    const result = await pool.query(
      "DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, userId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Push subscription not found" });
    return res.json({ success: true, deleted: result.rows[0].id });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete push subscription" });
  }
};
