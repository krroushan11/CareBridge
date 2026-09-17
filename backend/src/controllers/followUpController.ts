import { Request, Response } from "express";
import { pool } from "../config/database";
import {
  calendarDateSchema,
  createFollowUpSchema,
  updateFollowUpSchema,
} from "../services/trackerService";

const FOLLOW_UP_COLUMNS = `id, user_id, document_id, verified_care_plan_id, title, description,
  provider_or_specialist, appointment_date, appointment_time, due_date, status,
  completed_at, cancelled_at, source_text, record_fingerprint, created_at, updated_at`;

const FOLLOW_UP_SELECT = `SELECT ${FOLLOW_UP_COLUMNS} FROM follow_ups WHERE user_id = $1`;

const ownerId = (req: Request) => (req as any).user?.id as string | undefined;
const invalid = (res: Response, message: string) => res.status(400).json({ success: false, message });
const unauthorized = (res: Response) => res.status(401).json({ success: false, message: "Authentication required" });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

/**
 * Derives status-transition updates. Completion and cancellation always stamp
 * their dedicated timestamp; moving back to an active status clears terminal
 * timestamps so reopening produces a consistent record.
 */
const REMINDER_WINDOW_DAYS = 14;
const VALID_FOLLOW_UP_STATUSES = ["pending", "scheduled", "completed", "cancelled", "missed"];

export const createFollowUp = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);

  const parsed = createFollowUpSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid follow-up data");

  const data = parsed.data;
  const status = data.status ?? "pending";

  try {
    // Terminal statuses created up front must carry their matching timestamp so
    // the table's status/timestamp consistency constraints hold.
    const saved = await pool.query(
      `INSERT INTO follow_ups (user_id, title, description, provider_or_specialist,
         appointment_date, appointment_time, due_date, status, completed_at, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${FOLLOW_UP_COLUMNS}`,
      [
        userId,
        data.title,
        data.description ?? null,
        data.provider_or_specialist ?? null,
        data.appointment_date ?? null,
        data.appointment_time ?? null,
        data.due_date ?? null,
        status,
        status === "completed" ? new Date() : null,
        status === "cancelled" ? new Date() : null,
      ]
    );
    return res.status(201).json({ success: true, follow_up: saved.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create follow-up" });
  }
};

export const listFollowUps = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);

  const conditions: string[] = [];
  const values: unknown[] = [userId];

  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  if (status) {
    if (!VALID_FOLLOW_UP_STATUSES.includes(status)) {
      return invalid(res, "Invalid status filter");
    }
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";

  if (from) {
    const parsedFrom = calendarDateSchema.safeParse(from);
    if (!parsedFrom.success) return invalid(res, "Invalid from date");
    values.push(from);
    conditions.push(`COALESCE(appointment_date, due_date) >= $${values.length}`);
  }

  if (to) {
    const parsedTo = calendarDateSchema.safeParse(to);
    if (!parsedTo.success) return invalid(res, "Invalid to date");
    values.push(to);
    conditions.push(`COALESCE(appointment_date, due_date) <= $${values.length}`);
  }

  const whereClause = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";

  try {
    const result = await pool.query(
      `${FOLLOW_UP_SELECT}${whereClause}
       ORDER BY COALESCE(appointment_date, due_date) ASC NULLS LAST, created_at DESC`,
      values
    );

    const now = new Date();
    const followUps = result.rows.map((row) => {
      const effectiveDate = row.appointment_date || row.due_date;
      const overdue = Boolean(
        effectiveDate &&
        !["completed", "cancelled"].includes(row.status) &&
        new Date(`${String(effectiveDate).slice(0, 10)}T23:59:59.999Z`) < now
      );
      return { ...row, overdue };
    });

    return res.json({
      success: true,
      follow_ups: followUps,
      counts: {
        total: followUps.length,
        pending: followUps.filter((row) => row.status === "pending").length,
        scheduled: followUps.filter((row) => row.status === "scheduled").length,
        completed: followUps.filter((row) => row.status === "completed").length,
        cancelled: followUps.filter((row) => row.status === "cancelled").length,
        missed: followUps.filter((row) => row.status === "missed").length,
        overdue: followUps.filter((row) => row.overdue).length,
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve follow-ups" });
  }
};

export const getFollowUp = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Follow-up not found" });

  try {
    const result = await pool.query(`${FOLLOW_UP_SELECT} AND id = $2`, [userId, id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Follow-up not found" });
    }
    return res.json({ success: true, follow_up: result.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve follow-up" });
  }
};

export const updateFollowUp = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Follow-up not found" });

  const parsed = updateFollowUpSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid follow-up data");

  const data = parsed.data;
  const assignments: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 0;

  const pushValue = (column: string, value: unknown) => {
    paramIndex += 1;
    assignments.push(`${column} = $${paramIndex}`);
    values.push(value);
  };

  if (data.title !== undefined) pushValue("title", data.title);
  if (data.description !== undefined) pushValue("description", data.description);
  if (data.provider_or_specialist !== undefined) pushValue("provider_or_specialist", data.provider_or_specialist);
  if (data.appointment_date !== undefined) pushValue("appointment_date", data.appointment_date);
  if (data.appointment_time !== undefined) pushValue("appointment_time", data.appointment_time);
  if (data.due_date !== undefined) pushValue("due_date", data.due_date);

  if (data.status !== undefined) {
    paramIndex += 1;
    assignments.push(`status = $${paramIndex}`);
    values.push(data.status);
    for (const [status, column] of Object.entries({
      completed: "completed_at",
      cancelled: "cancelled_at",
    })) {
      paramIndex += 1;
      assignments.push(`${column} = $${paramIndex}`);
      values.push(status === data.status ? new Date() : null);
    }
  }

  if (assignments.length === 0) return invalid(res, "No follow-up fields to update");

  const dateChecks: string[] = [];
  if (data.appointment_date !== undefined) dateChecks.push("appointment_date");
  if (data.due_date !== undefined) dateChecks.push("due_date");

  try {
    if (dateChecks.length > 0) {
      const existing = await pool.query(
        `SELECT appointment_date, due_date FROM follow_ups WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Follow-up not found" });
      }
      const appointmentDate = data.appointment_date !== undefined
        ? data.appointment_date
        : existing.rows[0].appointment_date;
      const dueDate = data.due_date !== undefined ? data.due_date : existing.rows[0].due_date;
      if (appointmentDate && dueDate && String(dueDate) < String(appointmentDate)) {
        return invalid(res, "Due date must not be before the appointment date");
      }
    }

    paramIndex += 1;
    const idParam = `$${paramIndex}`;
    values.push(id);
    paramIndex += 1;
    const userParam = `$${paramIndex}`;
    values.push(userId);

    const updated = await pool.query(
      `UPDATE follow_ups SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = ${idParam} AND user_id = ${userParam}
       RETURNING ${FOLLOW_UP_COLUMNS}`,
      values
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Follow-up not found" });
    }

    return res.json({ success: true, follow_up: updated.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update follow-up" });
  }
};

export const deleteFollowUp = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Follow-up not found" });

  try {
    const deleted = await pool.query(
      `DELETE FROM follow_ups WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Follow-up not found" });
    }
    return res.json({ success: true, message: "Follow-up deleted" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete follow-up" });
  }
};

// The complete action is a semantic alias of PATCH { status: "completed" } so
// clients get an explicit task-completion endpoint without duplicated logic.
export const completeFollowUp = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Follow-up not found" });

  try {
    const updated = await pool.query(
      `UPDATE follow_ups
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
           cancelled_at = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status NOT IN ('completed')
       RETURNING ${FOLLOW_UP_COLUMNS}`,
      [id, userId]
    );

    if (updated.rows.length === 0) {
      const existing = await pool.query(
        `SELECT ${FOLLOW_UP_COLUMNS} FROM follow_ups WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Follow-up not found" });
      }
      return res.json({ success: true, already_completed: true, follow_up: existing.rows[0] });
    }

    return res.json({ success: true, already_completed: false, follow_up: updated.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to complete follow-up" });
  }
};

export const getFollowUpReminders = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);

  const days = Number(req.query.days ?? REMINDER_WINDOW_DAYS);
  const windowDays = Number.isInteger(days) && days >= 1 && days <= 90 ? days : REMINDER_WINDOW_DAYS;

  try {
    const result = await pool.query(
      `SELECT ${FOLLOW_UP_COLUMNS} FROM follow_ups
       WHERE user_id = $1
         AND status IN ('pending', 'scheduled')
         AND COALESCE(appointment_date, due_date) IS NOT NULL
         AND COALESCE(appointment_date, due_date) BETWEEN CURRENT_DATE
             AND CURRENT_DATE + ($2::int - 1)
       ORDER BY COALESCE(appointment_date, due_date) ASC`,
      [userId, windowDays]
    );

    return res.json({
      success: true,
      window_days: windowDays,
      reminders: result.rows.map((row) => ({
        id: row.id,
        kind: "follow_up",
        title: row.title,
        date: row.appointment_date || row.due_date,
        appointment_time: row.appointment_time,
        status: row.status,
      })),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve follow-up reminders" });
  }
};
