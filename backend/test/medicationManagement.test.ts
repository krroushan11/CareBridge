import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import {
  createMedication,
  listMedications,
  markMedicationSkipped,
  markMedicationTaken,
} from "../src/controllers/medicationController";
import { authenticateToken } from "../src/middlewares/authMiddleware";

const OWNER_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ID = "66666666-6666-4666-8666-666666666666";
const MEDICATION_ID = "77777777-7777-4777-8777-777777777777";
const DOSE_ID = "88888888-8888-4888-8888-888888888888";
const originalQuery = pool.query.bind(pool);

const response = () => ({
  statusCode: 200,
  body: undefined as any,
  status(statusCode: number) { this.statusCode = statusCode; return this; },
  json(body: unknown) { this.body = body; return this; },
});

const medication = { id: MEDICATION_ID, active: true };
const scheduledDose = {
  id: DOSE_ID,
  medication_id: MEDICATION_ID,
  scheduled_at: "2026-09-16T08:00:00.000Z",
  status: "scheduled",
};

after(async () => {
  (pool as any).query = originalQuery;
  await pool.end();
});

test("unauthenticated medication listing is rejected", () => {
  const res = response();
  let nextCalled = false;
  authenticateToken({ headers: {} } as any, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("medication creation persists a daily schedule and dose times", async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    calls.push({ query, values });
    if (query.includes("INSERT INTO medications")) {
      return { rows: [{ ...medication, name: "Metformin", dose_times: ["08:00", "20:00"] }] };
    }
    return { rows: [] };
  };
  const res = response();
  await createMedication({ user: { id: OWNER_ID }, body: {
    name: "Metformin", dosage: "500", dosage_unit: "mg", dose_times: ["08:00", "20:00"],
    start_date: "2026-09-16", instructions: "Take with food",
  } } as any, res);
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].values[0], OWNER_ID);
  assert.deepEqual(JSON.parse(String(calls[0].values[5])), ["08:00", "20:00"]);
  assert.equal(calls[0].values[6], "2026-09-16");
  assert.ok(calls.some((call) => call.query.includes("INSERT INTO medication_doses")));
});

test("authenticated users receive only their medication data and adherence analytics", async () => {
  const now = new Date();
  const past = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const calls: Array<{ query: string; values: unknown[] }> = [];
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    calls.push({ query, values });
    if (query.includes("FROM medications WHERE user_id")) {
      return { rows: [{ ...medication, name: "Metformin", dose_times: ["08:00"], frequency: "daily" }] };
    }
    if (query.includes("FROM medication_doses d")) {
      return { rows: [
        { ...scheduledDose, scheduled_at: past, status: "taken", medication_name: "Metformin" },
        { ...scheduledDose, id: "99999999-9999-4999-8999-999999999999", scheduled_at: future, status: "scheduled", medication_name: "Metformin" },
      ] };
    }
    return { rows: [] };
  };
  const res = response();
  await listMedications({ user: { id: OWNER_ID } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.medications.length, 1);
  assert.equal(res.body.medications[0].adherence.percentage, 100);
  assert.equal(res.body.analytics.eligible_doses, 1);
  assert.ok(calls.every((call) => !call.values.length || call.values[0] === OWNER_ID));
});

test("taking a due dose records its actual taken timestamp for the owner", async () => {
  (pool as any).query = async (query: string) => {
    if (query.includes("SELECT id, active FROM medications")) return { rows: [medication] };
    if (query.includes("SELECT id, status, scheduled_at")) return { rows: [scheduledDose] };
    if (query.includes("UPDATE medication_doses")) return { rows: [{ ...scheduledDose, status: "taken", taken_at: new Date() }] };
    return { rows: [] };
  };
  const res = response();
  await markMedicationTaken({ params: { id: MEDICATION_ID }, user: { id: OWNER_ID }, body: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dose.status, "taken");
  assert.equal(res.body.already_recorded, false);
});

test("a repeated taken action is idempotent and does not insert another dose", async () => {
  let updateCalled = false;
  (pool as any).query = async (query: string) => {
    if (query.includes("SELECT id, active FROM medications")) return { rows: [medication] };
    if (query.includes("SELECT id, status, scheduled_at")) return { rows: [{ ...scheduledDose, status: "taken" }] };
    if (query.includes("SET status = $1")) updateCalled = true;
    return { rows: [] };
  };
  const res = response();
  await markMedicationTaken({ params: { id: MEDICATION_ID }, user: { id: OWNER_ID }, body: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.already_recorded, true);
  assert.equal(updateCalled, false);
});

test("another user cannot take an owner's medication", async () => {
  (pool as any).query = async (query: string, values: unknown[]) => {
    if (query.includes("SELECT id, active FROM medications")) {
      assert.equal(values[1], OTHER_ID);
      return { rows: [] };
    }
    return { rows: [] };
  };
  const res = response();
  await markMedicationTaken({ params: { id: MEDICATION_ID }, user: { id: OTHER_ID }, body: {} } as any, res);
  assert.equal(res.statusCode, 404);
});

test("skipping a due dose records skipped status", async () => {
  (pool as any).query = async (query: string) => {
    if (query.includes("SELECT id, active FROM medications")) return { rows: [medication] };
    if (query.includes("SELECT id, status, scheduled_at")) return { rows: [scheduledDose] };
    if (query.includes("UPDATE medication_doses")) return { rows: [{ ...scheduledDose, status: "skipped", skipped_at: new Date() }] };
    return { rows: [] };
  };
  const res = response();
  await markMedicationSkipped({ params: { id: MEDICATION_ID }, user: { id: OWNER_ID }, body: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dose.status, "skipped");
});

test("missed-dose reconciliation uses the configured grace period", async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    calls.push({ query, values });
    if (query.includes("FROM medications WHERE user_id")) return { rows: [] };
    if (query.includes("FROM medication_doses d")) return { rows: [] };
    return { rows: [] };
  };
  const res = response();
  await listMedications({ user: { id: OWNER_ID } } as any, res);
  const reconciliation = calls.find((call) => call.query.includes("SET status = 'missed'"));
  assert.ok(reconciliation);
  assert.match(reconciliation!.query, /make_interval\(mins => m\.grace_period_minutes\)/);
});
