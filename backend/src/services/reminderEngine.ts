import { pool } from "../config/database";
import { sendReminderEmail } from "./emailService";

export type ReminderKind = "medication" | "follow_up" | "medical_test";
let scheduler: NodeJS.Timeout | undefined;

export const generateReminders = async (windowDays = 1): Promise<number> => {
  const result = await pool.query(
    `INSERT INTO notifications
       (user_id, kind, title, body, scheduled_for, source_id, dedupe_key)
     SELECT user_id, kind, title, body, scheduled_for, source_id,
            kind || ':' || source_id::text || ':' || to_char(scheduled_for, 'YYYY-MM-DD"T"HH24:MI')
     FROM (
       SELECT d.user_id, 'medication'::text AS kind,
              'Medication reminder' AS title,
              'Time to take ' || m.name AS body,
              d.scheduled_at AS scheduled_for, d.id AS source_id
       FROM medication_doses d
       JOIN medications m ON m.id = d.medication_id AND m.user_id = d.user_id
       WHERE d.status = 'scheduled' AND m.active = TRUE
         AND d.scheduled_at + make_interval(mins => m.grace_period_minutes) >= CURRENT_TIMESTAMP
         AND d.scheduled_at < CURRENT_TIMESTAMP + ($1::int * INTERVAL '1 day')
       UNION ALL
       SELECT user_id, 'follow_up', title,
              COALESCE(description, 'Upcoming follow-up'), COALESCE(appointment_date, due_date)::timestamp, id
       FROM follow_ups
       WHERE status IN ('pending', 'scheduled')
         AND COALESCE(appointment_date, due_date) IS NOT NULL
         AND COALESCE(appointment_date, due_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1::int - 1)
       UNION ALL
       SELECT user_id, 'medical_test', test_name,
              COALESCE(instructions, 'Upcoming medical test'), scheduled_date::timestamp, id
       FROM medical_tests
       WHERE status IN ('pending', 'scheduled')
         AND scheduled_date IS NOT NULL
         AND scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1::int - 1)
     ) reminders
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [windowDays]
  );
  return result.rowCount || 0;
};

export const deliverPendingReminders = async (): Promise<void> => {
  const result = await pool.query(
    `SELECT n.id, n.user_id, n.title, n.body, u.email
     FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.delivery_status = 'pending'
       AND (n.scheduled_for IS NULL OR n.scheduled_for <= CURRENT_TIMESTAMP)
     ORDER BY n.created_at ASC LIMIT 100`
  );
  for (const row of result.rows) {
    try {
      const delivered = await sendReminderEmail(row.email, row.title, row.body);
      await pool.query(
        `UPDATE notifications
         SET delivery_status = $2, delivery_error = $3,
             delivered_at = CASE WHEN $2 = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.id, delivered ? "sent" : "skipped", delivered ? null : "Email delivery is not configured"]
      );
    } catch (error) {
      await pool.query(
        `UPDATE notifications SET delivery_status = 'failed', delivery_error = $2,
         updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [row.id, error instanceof Error ? error.message.slice(0, 500) : "Delivery failed"]
      ).catch(() => undefined);
    }
  }
};

export const runReminderWorker = async () => {
  try {
    await generateReminders();
    await deliverPendingReminders();
  } catch (error) {
    console.error("Reminder worker failed safely:", error);
  }
};

export const startReminderScheduler = (intervalMs = Number(process.env.REMINDER_INTERVAL_MS) || 60_000) => {
  if (scheduler) return scheduler;
  void runReminderWorker();
  scheduler = setInterval(() => void runReminderWorker(), intervalMs);
  scheduler.unref();
  return scheduler;
};

export const stopReminderScheduler = () => {
  if (scheduler) clearInterval(scheduler);
  scheduler = undefined;
};
