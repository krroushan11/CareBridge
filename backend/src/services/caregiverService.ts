import { Pool, PoolClient } from "pg";
import { pool } from "../config/database";

export const CAREGIVER_PERMISSIONS = [
  "view_care_plan",
  "view_tasks",
  "update_tasks",
  "view_follow_ups",
  "view_medical_tests",
  "view_medications",
] as const;

export type CaregiverPermission = (typeof CAREGIVER_PERMISSIONS)[number];

export const isCaregiverPermission = (value: unknown): value is CaregiverPermission =>
  typeof value === "string" &&
  (CAREGIVER_PERMISSIONS as readonly string[]).includes(value);

export const normalizePermissions = (values: unknown): CaregiverPermission[] =>
  Array.isArray(values)
    ? [...new Set(values.filter(isCaregiverPermission))]
    : [];

export const relationshipSelect = `
  SELECT r.id, r.patient_id, r.caregiver_id, r.invited_email, r.status,
         r.permissions, r.expires_at, r.accepted_at, r.rejected_at, r.revoked_at,
         r.created_at, r.updated_at,
         patient.name AS patient_name, patient.email AS patient_email,
         caregiver.name AS caregiver_name, caregiver.email AS caregiver_email
  FROM caregiver_relationships r
  JOIN users patient ON patient.id = r.patient_id
  JOIN users caregiver ON caregiver.id = r.caregiver_id`;

export const findRelationship = async (
  relationshipId: string,
  client: Pool | PoolClient = pool
) => {
  const result = await client.query(
    `${relationshipSelect} WHERE r.id = $1`,
    [relationshipId]
  );
  return result.rows[0] || null;
};

export const findActiveRelationshipForUser = async (
  patientId: string,
  userId: string,
  client: Pool | PoolClient = pool
) => {
  const result = await client.query(
    `${relationshipSelect}
     WHERE r.patient_id = $1 AND r.caregiver_id = $2 AND r.status = 'accepted'
       AND r.revoked_at IS NULL AND r.expires_at > CURRENT_TIMESTAMP`,
    [patientId, userId]
  );
  return result.rows[0] || null;
};

export const hasPermission = (
  relationship: { permissions?: unknown } | null,
  permission: CaregiverPermission
) => normalizePermissions(relationship?.permissions).includes(permission);

export const relationshipForAccess = async (
  relationshipId: string,
  userId: string,
  permission: CaregiverPermission,
  client: Pool | PoolClient = pool
) => {
  const relationship = await findRelationship(relationshipId, client);
  if (!relationship || relationship.status !== "accepted" ||
      relationship.revoked_at || new Date(relationship.expires_at) <= new Date()) {
    return null;
  }
  const isPatient = relationship.patient_id === userId;
  const isCaregiver = relationship.caregiver_id === userId;
  if (!isPatient && (!isCaregiver || !hasPermission(relationship, permission))) {
    return null;
  }
  return relationship;
};
