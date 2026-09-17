import { Request, Response } from "express";
import { pool } from "../config/database";
import {
  calendarDateSchema,
  createMedicalTestSchema,
  updateMedicalTestSchema,
} from "../services/trackerService";

const MEDICAL_TEST_COLUMNS = `id, user_id, document_id, verified_care_plan_id, test_name, instructions,
  scheduled_date, result_summary, result_document_id, status, completed_at, cancelled_at,
  source_text, record_fingerprint, created_at, updated_at`;

const MEDICAL_TEST_SELECT = `SELECT ${MEDICAL_TEST_COLUMNS} FROM medical_tests WHERE user_id = $1`;

const REMINDER_WINDOW_DAYS = 14;
const VALID_MEDICAL_TEST_STATUSES = ["pending", "scheduled", "completed", "cancelled"];

const ownerId = (req: Request) => (req as any).user?.id as string | undefined;
const invalid = (res: Response, message: string) => res.status(400).json({ success: false, message });
const unauthorized = (res: Response) => res.status(401).json({ success: false, message: "Authentication required" });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

export const createMedicalTest = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);

  const parsed = createMedicalTestSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid medical test data");

  const data = parsed.data;
  const status = data.status ?? "pending";

  try {
    // A test created directly as completed/cancelled needs the matching
    // timestamp so the status/timestamp consistency constraints hold.
    const saved = await pool.query(
      `INSERT INTO medical_tests (user_id, test_name, instructions, scheduled_date,
         result_summary, status, completed_at, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${MEDICAL_TEST_COLUMNS}`,
      [
        userId,
        data.test_name,
        data.instructions ?? null,
        data.scheduled_date ?? null,
        data.result_summary ?? null,
        status,
        status === "completed" ? new Date() : null,
        status === "cancelled" ? new Date() : null,
      ]
    );
    return res.status(201).json({ success: true, medical_test: saved.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create medical test" });
  }
};

export const listMedicalTests = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);

  const conditions: string[] = [];
  const values: unknown[] = [userId];

  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  if (status) {
    if (!VALID_MEDICAL_TEST_STATUSES.includes(status)) {
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
    conditions.push(`scheduled_date >= $${values.length}`);
  }

  if (to) {
    const parsedTo = calendarDateSchema.safeParse(to);
    if (!parsedTo.success) return invalid(res, "Invalid to date");
    values.push(to);
    conditions.push(`scheduled_date <= $${values.length}`);
  }

  const whereClause = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";

  try {
    const result = await pool.query(
      `${MEDICAL_TEST_SELECT}${whereClause}
       ORDER BY scheduled_date ASC NULLS LAST, created_at DESC`,
      values
    );

    const now = new Date();
    const tests = result.rows.map((row) => {
      const overdue = Boolean(
        row.scheduled_date &&
        !["completed", "cancelled"].includes(row.status) &&
        new Date(`${String(row.scheduled_date).slice(0, 10)}T23:59:59.999Z`) < now
      );
      return { ...row, overdue };
    });

    return res.json({
      success: true,
      medical_tests: tests,
      counts: {
        total: tests.length,
        pending: tests.filter((row) => row.status === "pending").length,
        scheduled: tests.filter((row) => row.status === "scheduled").length,
        completed: tests.filter((row) => row.status === "completed").length,
        cancelled: tests.filter((row) => row.status === "cancelled").length,
        overdue: tests.filter((row) => row.overdue).length,
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve medical tests" });
  }
};

export const getMedicalTest = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Medical test not found" });

  try {
    const result = await pool.query(`${MEDICAL_TEST_SELECT} AND id = $2`, [userId, id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical test not found" });
    }
    return res.json({ success: true, medical_test: result.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve medical test" });
  }
};

export const updateMedicalTest = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Medical test not found" });

  const parsed = updateMedicalTestSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid medical test data");

  const data = parsed.data;
  const assignments: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 0;

  const pushValue = (column: string, value: unknown) => {
    paramIndex += 1;
    assignments.push(`${column} = $${paramIndex}`);
    values.push(value);
  };

  if (data.test_name !== undefined) pushValue("test_name", data.test_name);
  if (data.instructions !== undefined) pushValue("instructions", data.instructions);
  if (data.scheduled_date !== undefined) pushValue("scheduled_date", data.scheduled_date);
  if (data.result_summary !== undefined) pushValue("result_summary", data.result_summary);

  if (data.status !== undefined) {
    pushValue("status", data.status);
    pushValue("completed_at", data.status === "completed" ? new Date() : null);
    pushValue("cancelled_at", data.status === "cancelled" ? new Date() : null);
  }

  if (assignments.length === 0) return invalid(res, "No medical test fields to update");

  try {
    paramIndex += 1;
    const idParam = `$${paramIndex}`;
    values.push(id);
    paramIndex += 1;
    const userParam = `$${paramIndex}`;
    values.push(userId);

    const updated = await pool.query(
      `UPDATE medical_tests SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = ${idParam} AND user_id = ${userParam}
       RETURNING ${MEDICAL_TEST_COLUMNS}`,
      values
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical test not found" });
    }

    return res.json({ success: true, medical_test: updated.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update medical test" });
  }
};

export const deleteMedicalTest = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Medical test not found" });

  try {
    const deleted = await pool.query(
      `DELETE FROM medical_tests WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical test not found" });
    }
    return res.json({ success: true, message: "Medical test deleted" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete medical test" });
  }
};

// Completion preserves the scheduled date and stamps completed_at; it never
// invents a result. Repeating the action on a completed test is idempotent.
export const completeMedicalTest = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  const id = req.params.id;
  if (!validId(id)) return res.status(404).json({ success: false, message: "Medical test not found" });

  const parsed = updateMedicalTestSchema.pick({ result_summary: true }).strict().safeParse(req.body || {});
  if (!parsed.success) return invalid(res, "Invalid medical test data");

  try {
    const updated = await pool.query(
      `UPDATE medical_tests
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
           cancelled_at = NULL,
           result_summary = COALESCE($3, result_summary), updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status NOT IN ('completed')
       RETURNING ${MEDICAL_TEST_COLUMNS}`,
      [id, userId, parsed.data.result_summary ?? null]
    );

    if (updated.rows.length === 0) {
      const existing = await pool.query(
        `SELECT ${MEDICAL_TEST_COLUMNS} FROM medical_tests WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Medical test not found" });
      }
      return res.json({ success: true, already_completed: true, medical_test: existing.rows[0] });
    }

    return res.json({ success: true, already_completed: false, medical_test: updated.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to complete medical test" });
  }
};

export const getMedicalTestReminders = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);

  const days = Number(req.query.days ?? REMINDER_WINDOW_DAYS);
  const windowDays = Number.isInteger(days) && days >= 1 && days <= 90 ? days : REMINDER_WINDOW_DAYS;

  try {
    const result = await pool.query(
      `SELECT ${MEDICAL_TEST_COLUMNS} FROM medical_tests
       WHERE user_id = $1
         AND status IN ('pending', 'scheduled')
         AND scheduled_date IS NOT NULL
         AND scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2::int - 1)
       ORDER BY scheduled_date ASC`,
      [userId, windowDays]
    );

    return res.json({
      success: true,
      window_days: windowDays,
      reminders: result.rows.map((row) => ({
        id: row.id,
        kind: "medical_test",
        title: row.test_name,
        date: row.scheduled_date,
        status: row.status,
      })),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve medical test reminders" });
  }
};
