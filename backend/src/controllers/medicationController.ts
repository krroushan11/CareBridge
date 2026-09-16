import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../config/database";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Dose times must use HH:MM");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD").refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  "Invalid date"
);
const optionalText = z.string().trim().min(1).max(2000).nullable().optional();
const medicationSchema = z.object({
  name: z.string().trim().min(1).max(255),
  dosage: z.string().trim().min(1).max(100).nullable().optional(),
  dosage_unit: z.string().trim().min(1).max(30).nullable().optional(),
  frequency: z.literal("daily").default("daily"),
  dose_times: z.array(timeSchema).min(1).max(8).refine((times) => new Set(times).size === times.length, "Dose times must be unique"),
  start_date: dateSchema.optional(),
  end_date: dateSchema.nullable().optional(),
  active: z.boolean().optional(),
  instructions: optionalText,
  notes: optionalText,
  grace_period_minutes: z.number().int().min(0).max(1440).optional(),
}).strict().refine(
  (value) => !value.start_date || !value.end_date || value.end_date >= value.start_date,
  "End date must not be before start date"
);
const doseActionSchema = z.object({
  scheduled_at: z.string().trim().max(40).optional().refine(
    (value) => value === undefined || !Number.isNaN(Date.parse(value)),
    "scheduled_at must be a valid timestamp"
  ),
}).strict();

const ownerId = (req: Request) => (req as any).user?.id as string | undefined;
const invalid = (res: Response, message: string) => res.status(400).json({ success: false, message });

const refreshMedicationDoses = async (userId: string, medicationId?: string) => {
  const values = medicationId ? [userId, medicationId] : [userId];
  const medicationFilter = medicationId ? "AND m.id = $2" : "";

  await pool.query(
    `INSERT INTO medication_doses (medication_id, user_id, scheduled_at)
     SELECT m.id, m.user_id, scheduled_day::date + dose_time::time
     FROM medications m
     CROSS JOIN LATERAL generate_series(
       m.start_date::timestamp,
       LEAST(COALESCE(m.end_date, CURRENT_DATE + 30), CURRENT_DATE + 30)::timestamp,
       INTERVAL '1 day'
     ) AS schedule(scheduled_day)
     CROSS JOIN LATERAL jsonb_array_elements_text(m.dose_times) AS times(dose_time)
     WHERE m.user_id = $1 AND m.active = TRUE ${medicationFilter}
     ON CONFLICT (medication_id, scheduled_at) DO NOTHING`,
    values
  );

  await pool.query(
    `UPDATE medication_doses d
     SET status = 'missed', missed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     FROM medications m
     WHERE d.medication_id = m.id
       AND d.user_id = $1
       AND m.user_id = $1
       AND d.status = 'scheduled'
       AND d.scheduled_at + make_interval(mins => m.grace_period_minutes) <= CURRENT_TIMESTAMP
       ${medicationId ? "AND d.medication_id = $2" : ""}`,
    values
  );
};

const medicationForOwner = async (userId: string, medicationId: string) => {
  const result = await pool.query(
    `SELECT id, active FROM medications WHERE id = $1 AND user_id = $2`,
    [medicationId, userId]
  );
  return result.rows[0] || null;
};

export const createMedication = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });

  const parsed = medicationSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid medication data");

  const medication = parsed.data;
  const startDate = medication.start_date || new Date().toISOString().slice(0, 10);
  if (medication.end_date && medication.end_date < startDate) return invalid(res, "End date must not be before start date");

  try {
    const saved = await pool.query(
      `INSERT INTO medications (
         user_id, name, dosage, dosage_unit, frequency, dose_times, start_date, end_date,
         active, instructions, notes, grace_period_minutes
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
       RETURNING id, name, dosage, dosage_unit, frequency, dose_times, start_date, end_date,
                 active, instructions, notes, grace_period_minutes, created_at, updated_at`,
      [
        userId, medication.name, medication.dosage || null, medication.dosage_unit || null,
        medication.frequency, JSON.stringify(medication.dose_times), startDate, medication.end_date || null,
        medication.active ?? true, medication.instructions || null, medication.notes || null,
        medication.grace_period_minutes ?? 240,
      ]
    );
    await refreshMedicationDoses(userId, saved.rows[0].id);
    return res.status(201).json({ success: true, medication: saved.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create medication" });
  }
};

export const listMedications = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });

  try {
    await refreshMedicationDoses(userId);
    const [medicationResult, doseResult] = await Promise.all([
      pool.query(
        `SELECT id, name, dosage, dosage_unit, frequency, dose_times, start_date, end_date,
                active, instructions, notes, grace_period_minutes, created_at, updated_at
         FROM medications WHERE user_id = $1 ORDER BY active DESC, created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT d.id, d.medication_id, d.scheduled_at, d.status, d.taken_at, d.skipped_at, d.missed_at,
                m.name AS medication_name, m.dosage, m.dosage_unit, m.grace_period_minutes
         FROM medication_doses d
         JOIN medications m ON m.id = d.medication_id AND m.user_id = $1
         WHERE d.user_id = $1
         ORDER BY d.scheduled_at DESC`,
        [userId]
      ),
    ]);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const doses = doseResult.rows;
    const medicationSummaries = medicationResult.rows.map((medication) => {
      const medicationDoses = doses.filter((dose) => dose.medication_id === medication.id);
      const eligible = medicationDoses.filter((dose) => new Date(dose.scheduled_at) <= now);
      const taken = eligible.filter((dose) => dose.status === "taken").length;
      return {
        ...medication,
        today_doses: medicationDoses.filter((dose) => String(dose.scheduled_at).slice(0, 10) === today),
        adherence: {
          eligible_doses: eligible.length,
          taken_doses: taken,
          skipped_doses: eligible.filter((dose) => dose.status === "skipped").length,
          missed_doses: eligible.filter((dose) => dose.status === "missed").length,
          percentage: eligible.length === 0 ? null : Number(((taken / eligible.length) * 100).toFixed(1)),
        },
      };
    });
    const eligible = doses.filter((dose) => new Date(dose.scheduled_at) <= now);
    const taken = eligible.filter((dose) => dose.status === "taken").length;
    return res.json({
      success: true,
      medications: medicationSummaries,
      analytics: {
        eligible_doses: eligible.length,
        taken_doses: taken,
        skipped_doses: eligible.filter((dose) => dose.status === "skipped").length,
        missed_doses: eligible.filter((dose) => dose.status === "missed").length,
        adherence_percentage: eligible.length === 0 ? null : Number(((taken / eligible.length) * 100).toFixed(1)),
        recent_missed_doses: doses.filter((dose) => dose.status === "missed").slice(0, 10),
        due_doses: doses.filter((dose) => {
          const scheduledAt = new Date(dose.scheduled_at).getTime();
          return dose.status === "scheduled" && scheduledAt <= now.getTime()
            && scheduledAt + dose.grace_period_minutes * 60_000 > now.getTime();
        }).slice(0, 10),
        upcoming_doses: doses.filter((dose) => dose.status === "scheduled" && new Date(dose.scheduled_at) > now).reverse().slice(0, 10),
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve medications" });
  }
};

const recordDoseAction = async (req: Request, res: Response, action: "taken" | "skipped") => {
  const userId = ownerId(req);
  const medicationId = typeof req.params.id === "string" ? req.params.id : undefined;
  if (!userId) return res.status(401).json({ success: false, message: "Authentication required" });
  if (!medicationId) return invalid(res, "Medication ID is required");
  const parsed = doseActionSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, "Invalid dose action");

  try {
    const medication = await medicationForOwner(userId, medicationId);
    if (!medication) return res.status(404).json({ success: false, message: "Medication not found" });
    if (!medication.active) return res.status(409).json({ success: false, message: "Medication is inactive" });
    await refreshMedicationDoses(userId, medicationId);
    const doseResult = await pool.query(
      `SELECT id, status, scheduled_at FROM medication_doses
       WHERE medication_id = $1 AND user_id = $2
         AND ($3::timestamp IS NULL AND scheduled_at <= CURRENT_TIMESTAMP OR scheduled_at = $3::timestamp)
       ORDER BY scheduled_at ASC LIMIT 1`,
      [medicationId, userId, parsed.data.scheduled_at || null]
    );
    const dose = doseResult.rows[0];
    if (!dose) return res.status(404).json({ success: false, message: "No due medication dose found" });
    if (dose.status === action) return res.json({ success: true, already_recorded: true, dose });
    if (dose.status !== "scheduled") return res.status(409).json({ success: false, message: `Dose is already ${dose.status}` });
    const timestampColumn = action === "taken" ? "taken_at" : "skipped_at";
    const updated = await pool.query(
      `UPDATE medication_doses
       SET status = $1, ${timestampColumn} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3 AND status = 'scheduled'
       RETURNING id, medication_id, scheduled_at, status, taken_at, skipped_at, missed_at`,
      [action, dose.id, userId]
    );
    if (updated.rows.length === 0) return res.status(409).json({ success: false, message: "Dose was updated by another request" });
    return res.json({ success: true, already_recorded: false, dose: updated.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to record medication dose" });
  }
};

export const markMedicationTaken = (req: Request, res: Response) => recordDoseAction(req, res, "taken");
export const markMedicationSkipped = (req: Request, res: Response) => recordDoseAction(req, res, "skipped");
