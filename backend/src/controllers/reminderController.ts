import { Request, Response } from "express";
import { pool } from "../config/database";

const DEFAULT_WINDOW_DAYS = 14;

const ownerId = (req: Request) => (req as any).user?.id as string | undefined;

/**
 * Combined Phase 11 reminder feed for the authenticated owner. Follow-ups use
 * their appointment (or due) date; medical tests use their scheduled date.
 * Terminal statuses (completed/cancelled/missed) never produce reminders, and
 * each record appears once because the two queries cover disjoint tables.
 */
export const getUpcomingReminders = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const days = Number(req.query.days ?? DEFAULT_WINDOW_DAYS);
  const windowDays = Number.isInteger(days) && days >= 1 && days <= 90 ? days : DEFAULT_WINDOW_DAYS;

  try {
    const result = await pool.query(
      `SELECT 'follow_up' AS kind, id, title,
              COALESCE(appointment_date, due_date) AS date, status, appointment_time
       FROM follow_ups
       WHERE user_id = $1
         AND status IN ('pending', 'scheduled')
         AND COALESCE(appointment_date, due_date) IS NOT NULL
         AND COALESCE(appointment_date, due_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2::int - 1)
       UNION ALL
       SELECT 'medical_test' AS kind, id, test_name, scheduled_date AS date, status, NULL AS appointment_time
       FROM medical_tests
       WHERE user_id = $1
         AND status IN ('pending', 'scheduled')
         AND scheduled_date IS NOT NULL
         AND scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2::int - 1)
       ORDER BY date ASC, kind ASC`,
      [userId, windowDays]
    );

    return res.json({
      success: true,
      window_days: windowDays,
      reminders: result.rows,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve reminders" });
  }
};
