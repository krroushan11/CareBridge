import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../config/database";
import {
  CAREGIVER_PERMISSIONS,
  CaregiverPermission,
  findRelationship,
  hasPermission,
  normalizePermissions,
  relationshipForAccess,
} from "../services/caregiverService";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerId = (req: Request) => (req as any).user?.id as string | undefined;
const invalid = (res: Response, message: string) => res.status(400).json({ success: false, message });
const unauthorized = (res: Response) => res.status(401).json({ success: false, message: "Authentication required" });
const notFound = (res: Response) => res.status(404).json({ success: false, message: "Caregiver relationship not found" });
const validId = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

const inviteSchema = z.object({
  caregiver_email: z.string().trim().email().max(150).transform((value) => value.toLowerCase()),
  permissions: z.array(z.enum(CAREGIVER_PERMISSIONS)).max(CAREGIVER_PERMISSIONS.length).optional().default([]),
}).strict();
const permissionsSchema = z.object({
  permissions: z.array(z.enum(CAREGIVER_PERMISSIONS)).max(CAREGIVER_PERMISSIONS.length),
}).strict();
const taskStatusSchema = z.object({
  status: z.enum(["pending", "scheduled", "completed", "cancelled", "missed"]),
}).strict();

const safeRelationship = (row: any) => ({
  id: row.id,
  patient_id: row.patient_id,
  caregiver_id: row.caregiver_id,
  invited_email: row.invited_email,
  status: row.status,
  permissions: normalizePermissions(row.permissions),
  expires_at: row.expires_at,
  accepted_at: row.accepted_at,
  rejected_at: row.rejected_at,
  revoked_at: row.revoked_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
  patient: row.patient_name ? { name: row.patient_name, email: row.patient_email } : undefined,
  caregiver: row.caregiver_name ? { name: row.caregiver_name, email: row.caregiver_email } : undefined,
});

export const inviteCaregiver = async (req: Request, res: Response) => {
  const patientId = ownerId(req);
  if (!patientId) return unauthorized(res);
  if ((req as any).user?.role !== "patient") {
    return res.status(403).json({ success: false, message: "Only the patient can invite a caregiver" });
  }
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid caregiver invitation");

  try {
    const caregiver = await pool.query(
      `SELECT id, email FROM users WHERE email = $1 AND role = 'caregiver'`,
      [parsed.data.caregiver_email]
    );
    if (!caregiver.rows[0]) {
      return res.status(404).json({ success: false, message: "Caregiver account not found" });
    }
    if (caregiver.rows[0].id === patientId) {
      return invalid(res, "You cannot invite yourself");
    }
    const existing = await pool.query(
      `SELECT id FROM caregiver_relationships
       WHERE patient_id = $1 AND caregiver_id = $2 AND status IN ('pending', 'accepted')`,
      [patientId, caregiver.rows[0].id]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ success: false, message: "An active caregiver invitation already exists" });
    }
    const created = await pool.query(
      `INSERT INTO caregiver_relationships
         (patient_id, caregiver_id, invited_email, permissions)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, patient_id, caregiver_id, invited_email, status, permissions, expires_at, created_at`,
      [patientId, caregiver.rows[0].id, parsed.data.caregiver_email, JSON.stringify(parsed.data.permissions)]
    );
    return res.status(201).json({ success: true, relationship: safeRelationship(created.rows[0]) });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to create caregiver invitation" });
  }
};

export const listCaregiverRelationships = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  try {
    const result = await pool.query(
      `SELECT r.id, r.patient_id, r.caregiver_id, r.invited_email, r.status, r.permissions,
              r.expires_at, r.accepted_at, r.rejected_at, r.revoked_at, r.created_at, r.updated_at,
              patient.name AS patient_name, patient.email AS patient_email,
              caregiver.name AS caregiver_name, caregiver.email AS caregiver_email
       FROM caregiver_relationships r
       JOIN users patient ON patient.id = r.patient_id
       JOIN users caregiver ON caregiver.id = r.caregiver_id
       WHERE r.patient_id = $1 OR r.caregiver_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    return res.json({ success: true, relationships: result.rows.map(safeRelationship) });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve caregiver relationships" });
  }
};

export const acceptCaregiverInvitation = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id)) return notFound(res);
  try {
    const invitation = await findRelationship(req.params.id);
    if (!invitation || invitation.caregiver_id !== userId) return notFound(res);
    if (invitation.status === "accepted") return res.json({ success: true, relationship: safeRelationship(invitation) });
    if (invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date()) {
      return res.status(409).json({ success: false, message: "Invitation is no longer available" });
    }
    const updated = await pool.query(
      `UPDATE caregiver_relationships
       SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND caregiver_id = $2 AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
       RETURNING id, patient_id, caregiver_id, invited_email, status, permissions, expires_at, accepted_at, created_at, updated_at`,
      [req.params.id, userId]
    );
    return updated.rows[0]
      ? res.json({ success: true, relationship: safeRelationship(updated.rows[0]) })
      : res.status(409).json({ success: false, message: "Invitation is no longer available" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to accept invitation" });
  }
};

export const rejectCaregiverInvitation = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id)) return notFound(res);
  try {
    const updated = await pool.query(
      `UPDATE caregiver_relationships
       SET status = 'rejected', rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND caregiver_id = $2 AND status = 'pending'
       RETURNING id, patient_id, caregiver_id, invited_email, status, permissions, expires_at, rejected_at, created_at, updated_at`,
      [req.params.id, userId]
    );
    return updated.rows[0]
      ? res.json({ success: true, relationship: safeRelationship(updated.rows[0]) })
      : notFound(res);
  } catch {
    return res.status(500).json({ success: false, message: "Failed to reject invitation" });
  }
};

const patientRelationship = async (id: string, userId: string) => {
  const relationship = await findRelationship(id);
  return relationship && relationship.patient_id === userId ? relationship : null;
};

export const getCaregiverPermissions = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id)) return notFound(res);
  const relationship = await patientRelationship(req.params.id, userId);
  return relationship ? res.json({ success: true, relationship: safeRelationship(relationship) }) : notFound(res);
};

export const updateCaregiverPermissions = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id)) return notFound(res);
  const parsed = permissionsSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid caregiver permissions");
  try {
    const updated = await pool.query(
      `UPDATE caregiver_relationships
       SET permissions = $1::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND patient_id = $3 AND status = 'accepted'
       RETURNING id, patient_id, caregiver_id, invited_email, status, permissions, expires_at, accepted_at, revoked_at, created_at, updated_at`,
      [JSON.stringify(parsed.data.permissions), req.params.id, userId]
    );
    return updated.rows[0] ? res.json({ success: true, relationship: safeRelationship(updated.rows[0]) }) : notFound(res);
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update caregiver permissions" });
  }
};

export const revokeCaregiverAccess = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id)) return notFound(res);
  try {
    const updated = await pool.query(
      `UPDATE caregiver_relationships
       SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND patient_id = $2 AND status IN ('pending', 'accepted')
       RETURNING id, patient_id, caregiver_id, invited_email, status, permissions, expires_at, accepted_at, revoked_at, created_at, updated_at`,
      [req.params.id, userId]
    );
    return updated.rows[0] ? res.json({ success: true, relationship: safeRelationship(updated.rows[0]) }) : notFound(res);
  } catch {
    return res.status(500).json({ success: false, message: "Failed to revoke caregiver access" });
  }
};

export const getSharedCarePlan = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id)) return notFound(res);
  const relationship = await relationshipForAccess(req.params.id, userId, "view_care_plan");
  if (!relationship) return res.status(403).json({ success: false, message: "Care-plan access is not permitted" });
  try {
    const result = await pool.query(
      `SELECT id, document_id, verified_extraction, disclaimer, confirmed_at, updated_at
       FROM verified_care_plans WHERE user_id = $1 ORDER BY confirmed_at DESC LIMIT 1`,
      [relationship.patient_id]
    );
    return res.json({ success: true, relationship: safeRelationship(relationship), care_plan: result.rows[0] || null });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve shared care plan" });
  }
};

export const getSharedTasks = async (req: Request, res: Response) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id)) return notFound(res);
  const relationship = await relationshipForAccess(req.params.id, userId, "view_tasks");
  if (!relationship) return res.status(403).json({ success: false, message: "Shared-task access is not permitted" });
  try {
    const [followUps, tests, medications] = await Promise.all([
      hasPermission(relationship, "view_follow_ups")
        ? pool.query(`SELECT id, title, description, appointment_date, appointment_time, due_date, status FROM follow_ups WHERE user_id = $1 ORDER BY COALESCE(appointment_date, due_date) ASC NULLS LAST`, [relationship.patient_id])
        : Promise.resolve({ rows: [] }),
      hasPermission(relationship, "view_medical_tests")
        ? pool.query(`SELECT id, test_name, instructions, scheduled_date, status, result_summary FROM medical_tests WHERE user_id = $1 ORDER BY scheduled_date ASC NULLS LAST`, [relationship.patient_id])
        : Promise.resolve({ rows: [] }),
      hasPermission(relationship, "view_medications")
        ? pool.query(`SELECT id, name, dosage, dosage_unit, frequency, dose_times, active FROM medications WHERE user_id = $1 ORDER BY active DESC, created_at DESC`, [relationship.patient_id])
        : Promise.resolve({ rows: [] }),
    ]);
    return res.json({ success: true, relationship: safeRelationship(relationship), follow_ups: followUps.rows, medical_tests: tests.rows, medications: medications.rows });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to retrieve shared care tasks" });
  }
};

export const updateSharedFollowUp = async (req: Request, res: Response) => {
  return updateSharedTask(req, res, "follow_ups", "view_follow_ups");
};

export const updateSharedMedicalTest = async (req: Request, res: Response) => {
  return updateSharedTask(req, res, "medical_tests", "view_medical_tests");
};

const updateSharedTask = async (req: Request, res: Response, table: "follow_ups" | "medical_tests", viewPermission: CaregiverPermission) => {
  const userId = ownerId(req);
  if (!userId) return unauthorized(res);
  if (!validId(req.params.id) || !validId(req.params.taskId)) return notFound(res);
  const parsed = taskStatusSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, "Invalid task status");
  const relationship = await relationshipForAccess(req.params.id, userId, "update_tasks");
  if (!relationship || !hasPermission(relationship, viewPermission)) {
    return res.status(403).json({ success: false, message: "Task update is not permitted" });
  }
  const result = await pool.query(
    `UPDATE ${table}
     SET status = $1,
         completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
         cancelled_at = CASE WHEN $1 = 'cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND user_id = $3 RETURNING id, status, updated_at`,
    [parsed.data.status, req.params.taskId, relationship.patient_id]
  );
  return result.rows[0] ? res.json({ success: true, task: result.rows[0] }) : res.status(404).json({ success: false, message: "Task not found" });
};
