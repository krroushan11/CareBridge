import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import {
  acceptCaregiverInvitation,
  getSharedCarePlan,
  getSharedTasks,
  inviteCaregiver,
  rejectCaregiverInvitation,
  revokeCaregiverAccess,
  updateCaregiverPermissions,
} from "../src/controllers/caregiverController";

const originalQuery = pool.query.bind(pool);
const PATIENT_ID = "a0000000-0000-4000-8000-000000000001";
const CAREGIVER_ID = "a0000000-0000-4000-8000-000000000002";
const RELATIONSHIP_ID = "a0000000-0000-4000-8000-000000000003";

const response = () => ({
  statusCode: 200,
  body: undefined as any,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
});

after(async () => {
  (pool as any).query = originalQuery;
  await pool.end();
});

test("authorized invitation validates ownership, prevents self-invites, and creates pending access", async () => {
  const queries: string[] = [];
  (pool as any).query = async (sql: string) => {
    queries.push(sql);
    if (sql.includes("FROM users WHERE email")) {
      return { rows: [{ id: CAREGIVER_ID, email: "caregiver@example.com" }] };
    }
    if (sql.includes("FROM caregiver_relationships") && sql.includes("status IN")) return { rows: [] };
    return { rows: [{ id: RELATIONSHIP_ID, patient_id: PATIENT_ID, caregiver_id: CAREGIVER_ID, invited_email: "caregiver@example.com", status: "pending", permissions: ["view_tasks"], expires_at: new Date(Date.now() + 100000), created_at: new Date() }] };
  };
  const res = response();
  await inviteCaregiver({
    user: { id: PATIENT_ID, role: "patient" },
    body: { caregiver_email: "caregiver@example.com", permissions: ["view_tasks"] },
  } as any, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.relationship.status, "pending");
  assert.match(queries[queries.length - 1], /INSERT INTO caregiver_relationships/);
});

test("non-caregiver users cannot accept another user's invitation", async () => {
  (pool as any).query = async (sql: string) => {
    if (sql.includes("FROM caregiver_relationships")) {
      return { rows: [{ id: RELATIONSHIP_ID, caregiver_id: CAREGIVER_ID, status: "pending", expires_at: new Date(Date.now() + 100000) }] };
    }
    throw new Error("unexpected query");
  };
  const res = response();
  await acceptCaregiverInvitation({
    user: { id: PATIENT_ID },
    params: { id: RELATIONSHIP_ID },
  } as any, res);
  assert.equal(res.statusCode, 404);
});

test("invalid, duplicate, and self invitations are rejected", async () => {
  (pool as any).query = async (sql: string, values: unknown[]) => {
    if (sql.includes("FROM users WHERE email")) {
      return { rows: [{ id: values[0] === "self@example.com" ? PATIENT_ID : CAREGIVER_ID }] };
    }
    if (sql.includes("status IN")) return { rows: [{ id: "existing" }] };
    return { rows: [] };
  };
  const invalidResponse = response();
  await inviteCaregiver({ user: { id: PATIENT_ID, role: "patient" }, body: { caregiver_email: "bad" } } as any, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);

  const duplicateResponse = response();
  await inviteCaregiver({ user: { id: PATIENT_ID, role: "patient" }, body: { caregiver_email: "caregiver@example.com" } } as any, duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 409);

  (pool as any).query = async (sql: string) => sql.includes("FROM users WHERE email")
    ? { rows: [{ id: PATIENT_ID }] }
    : { rows: [] };
  const selfResponse = response();
  await inviteCaregiver({ user: { id: PATIENT_ID, role: "patient" }, body: { caregiver_email: "self@example.com" } } as any, selfResponse);
  assert.equal(selfResponse.statusCode, 400);
});

test("intended caregiver can accept and reject operations stay caregiver-scoped", async () => {
  (pool as any).query = async (sql: string) => {
    if (sql.includes("WHERE r.id")) return { rows: [{ id: RELATIONSHIP_ID, patient_id: PATIENT_ID, caregiver_id: CAREGIVER_ID, status: "pending", permissions: [], expires_at: new Date(Date.now() + 100000) }] };
    return { rows: [{ id: RELATIONSHIP_ID, patient_id: PATIENT_ID, caregiver_id: CAREGIVER_ID, status: "accepted", permissions: [], expires_at: new Date(Date.now() + 100000), accepted_at: new Date() }] };
  };
  const accepted = response();
  await acceptCaregiverInvitation({ user: { id: CAREGIVER_ID }, params: { id: RELATIONSHIP_ID } } as any, accepted);
  assert.equal(accepted.statusCode, 200);

  (pool as any).query = async (sql: string) => sql.includes("UPDATE caregiver_relationships")
    ? { rows: [{ id: RELATIONSHIP_ID, patient_id: PATIENT_ID, caregiver_id: CAREGIVER_ID, status: "rejected", permissions: [], expires_at: new Date() }] }
    : { rows: [] };
  const rejected = response();
  await rejectCaregiverInvitation({ user: { id: CAREGIVER_ID }, params: { id: RELATIONSHIP_ID } } as any, rejected);
  assert.equal(rejected.statusCode, 200);
});

test("expired invitations and permission escalation attempts are denied", async () => {
  (pool as any).query = async (sql: string) => sql.includes("WHERE r.id")
    ? { rows: [{ id: RELATIONSHIP_ID, patient_id: PATIENT_ID, caregiver_id: CAREGIVER_ID, status: "pending", permissions: [], expires_at: new Date(Date.now() - 1000) }] }
    : { rows: [] };
  const expired = response();
  await acceptCaregiverInvitation({ user: { id: CAREGIVER_ID }, params: { id: RELATIONSHIP_ID } } as any, expired);
  assert.equal(expired.statusCode, 409);

  const escalation = response();
  await updateCaregiverPermissions({ user: { id: PATIENT_ID }, params: { id: RELATIONSHIP_ID }, body: { permissions: ["admin_access"] } } as any, escalation);
  assert.equal(escalation.statusCode, 400);
});

test("permission updates and revocation remain patient-scoped", async () => {
  const statements: string[] = [];
  (pool as any).query = async (sql: string) => {
    statements.push(sql);
    return { rows: [{ id: RELATIONSHIP_ID, patient_id: PATIENT_ID, caregiver_id: CAREGIVER_ID, status: "accepted", permissions: ["view_tasks"], expires_at: new Date(Date.now() + 100000), accepted_at: new Date() }] };
  };
  const permissionsResponse = response();
  await updateCaregiverPermissions({
    user: { id: PATIENT_ID },
    params: { id: RELATIONSHIP_ID },
    body: { permissions: ["view_tasks", "update_tasks"] },
  } as any, permissionsResponse);
  assert.equal(permissionsResponse.statusCode, 200);
  assert.match(statements[0], /patient_id = \$3/);

  const revokeResponse = response();
  await revokeCaregiverAccess({
    user: { id: PATIENT_ID },
    params: { id: RELATIONSHIP_ID },
  } as any, revokeResponse);
  assert.equal(revokeResponse.statusCode, 200);
  assert.match(statements[1], /status IN \('pending', 'accepted'\)/);
});

test("shared tasks require an accepted relationship and explicit view permission", async () => {
  (pool as any).query = async (sql: string) => {
    if (sql.includes("WHERE r.id")) {
      return {
        rows: [{
          id: RELATIONSHIP_ID,
          patient_id: PATIENT_ID,
          caregiver_id: CAREGIVER_ID,
          status: "accepted",
          permissions: ["view_tasks"],
          expires_at: new Date(Date.now() + 100000),
        }],
      };
    }
    return { rows: [] };
  };
  const res = response();
  await getSharedTasks({
    user: { id: CAREGIVER_ID },
    params: { id: RELATIONSHIP_ID },
  } as any, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.follow_ups, []);
  assert.deepEqual(res.body.medical_tests, []);
});

test("shared care-plan access denies caregivers without the explicit permission", async () => {
  (pool as any).query = async (sql: string) => sql.includes("WHERE r.id")
    ? { rows: [{ id: RELATIONSHIP_ID, patient_id: PATIENT_ID, caregiver_id: CAREGIVER_ID, status: "accepted", permissions: [], expires_at: new Date(Date.now() + 100000) }] }
    : { rows: [] };
  const res = response();
  await getSharedCarePlan({ user: { id: CAREGIVER_ID }, params: { id: RELATIONSHIP_ID } } as any, res);
  assert.equal(res.statusCode, 403);
});
