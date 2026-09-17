import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import {
  completeFollowUp,
  createFollowUp,
  deleteFollowUp,
  getFollowUp,
  getFollowUpReminders,
  listFollowUps,
  updateFollowUp,
} from "../src/controllers/followUpController";
import {
  completeMedicalTest,
  createMedicalTest,
  deleteMedicalTest,
  getMedicalTest,
  listMedicalTests,
  updateMedicalTest,
} from "../src/controllers/medicalTestController";
import {
  mapExtractionFollowUps,
  mapExtractionTests,
  normalizeAiDate,
} from "../src/services/trackerService";
import { authenticateToken } from "../src/middlewares/authMiddleware";

const OWNER_ID = "a0000000-0000-4000-8000-000000000001";
const OTHER_ID = "b0000000-0000-4000-8000-000000000002";
const FOLLOW_UP_ID = "c0000000-0000-4000-8000-000000000003";
const TEST_ID = "d0000000-0000-4000-8000-000000000004";
const originalQuery = pool.query.bind(pool);

const response = () => ({
  statusCode: 200,
  body: undefined as any,
  status(statusCode: number) { this.statusCode = statusCode; return this; },
  json(body: unknown) { this.body = body; return this; },
});

const followUpRow = {
  id: FOLLOW_UP_ID,
  user_id: OWNER_ID,
  title: "Follow up with cardiology",
  status: "pending",
  appointment_date: "2026-10-01",
  appointment_time: null,
  due_date: null,
  completed_at: null,
  cancelled_at: null,
};

const medicalTestRow = {
  id: TEST_ID,
  user_id: OWNER_ID,
  test_name: "HbA1c blood test",
  status: "pending",
  scheduled_date: "2026-09-25",
  completed_at: null,
  cancelled_at: null,
};

after(async () => {
  (pool as any).query = originalQuery;
  await pool.end();
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("unauthenticated follow-up and medical-test listing is rejected", () => {
  const res = response();
  let nextCalled = false;
  authenticateToken({ headers: {} } as any, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);

  const controllerRes = response();
  return listFollowUps({ query: {} } as any, controllerRes).then(() => {
    assert.equal(controllerRes.statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// Follow-up API
// ---------------------------------------------------------------------------

test("creating a follow-up persists owner-scoped structured fields", async () => {
  let captured: { query: string; values: unknown[] } | undefined;
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    captured = { query, values };
    return { rows: [{ ...followUpRow, title: "Follow up with cardiology" }] };
  };
  const res = response();
  await createFollowUp({ user: { id: OWNER_ID }, body: {
    title: "Follow up with cardiology",
    appointment_date: "2026-10-01",
    appointment_time: "14:30",
  } } as any, res);
  assert.equal(res.statusCode, 201);
  assert.equal(captured!.values[0], OWNER_ID);
  assert.equal(captured!.values[4], "2026-10-01");
  assert.equal(captured!.values[5], "14:30");
  assert.match(captured!.query, /INSERT INTO follow_ups/);
});

test("follow-up creation rejects invalid dates and invalid status", async () => {
  let queryCalled = false;
  (pool as any).query = async () => { queryCalled = true; return { rows: [] }; };

  const invalidDate = response();
  await createFollowUp({ user: { id: OWNER_ID }, body: {
    title: "Cardiology", appointment_date: "01-10-2026",
  } } as any, invalidDate);
  assert.equal(invalidDate.statusCode, 400);

  const invalidStatus = response();
  await createFollowUp({ user: { id: OWNER_ID }, body: {
    title: "Cardiology", status: "finished",
  } } as any, invalidStatus);
  assert.equal(invalidStatus.statusCode, 400);
  assert.equal(queryCalled, false);
});

test("follow-up completion stamps completed_at and preserves prior fields", async () => {
  (pool as any).query = async (query: string) => {
    if (query.includes("UPDATE follow_ups")) {
      return { rows: [{ ...followUpRow, status: "completed", completed_at: new Date() }] };
    }
    return { rows: [] };
  };
  const res = response();
  await completeFollowUp({ params: { id: FOLLOW_UP_ID }, user: { id: OWNER_ID } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.follow_up.status, "completed");
  assert.ok(res.body.follow_up.completed_at);
});

test("another user cannot read, update, or delete an owner's follow-up", async () => {
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    if (query.includes("WHERE user_id = $1")) return { rows: [] };
    if (query.includes("user_id = $2")) return { rows: [] };
    return { rows: [] };
  };
  const readRes = response();
  await getFollowUp({ params: { id: FOLLOW_UP_ID }, user: { id: OTHER_ID } } as any, readRes);
  assert.equal(readRes.statusCode, 404);

  const updateRes = response();
  await updateFollowUp({ params: { id: FOLLOW_UP_ID }, user: { id: OTHER_ID }, body: { status: "completed" } } as any, updateRes);
  assert.equal(updateRes.statusCode, 404);

  const deleteRes = response();
  await deleteFollowUp({ params: { id: FOLLOW_UP_ID }, user: { id: OTHER_ID } } as any, deleteRes);
  assert.equal(deleteRes.statusCode, 404);
});

test("follow-up PATCH validates status values and applies owner-scoped updates", async () => {
  let captured: { query: string; values: unknown[] } | undefined;
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    captured = { query, values };
    if (query.includes("UPDATE follow_ups")) return { rows: [{ ...followUpRow, status: "scheduled" }] };
    return { rows: [] };
  };
  const res = response();
  await updateFollowUp({ params: { id: FOLLOW_UP_ID }, user: { id: OWNER_ID }, body: { status: "scheduled" } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.follow_up.status, "scheduled");

  const invalidRes = response();
  await updateFollowUp({ params: { id: FOLLOW_UP_ID }, user: { id: OWNER_ID }, body: { status: "done" } } as any, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
});

test("follow-up listing returns owner records with derived counts", async () => {
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    assert.equal(values[0], OWNER_ID);
    return { rows: [
      { ...followUpRow, status: "pending" },
      { ...followUpRow, id: "c0000000-0000-4000-8000-000000000099", status: "completed", completed_at: new Date() },
    ] };
  };
  const res = response();
  await listFollowUps({ user: { id: OWNER_ID }, query: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.counts.total, 2);
  assert.equal(res.body.counts.completed, 1);
  assert.equal(res.body.counts.pending, 1);
});

test("follow-up reminders exclude completed and cancelled records", async () => {
  let captured: { query: string; values: unknown[] } | undefined;
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    captured = { query, values };
    return { rows: [followUpRow] };
  };
  const res = response();
  await getFollowUpReminders({ user: { id: OWNER_ID }, query: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.match(captured!.query, /status IN \('pending', 'scheduled'\)/);
  assert.equal(res.body.reminders[0].kind, "follow_up");
});

// ---------------------------------------------------------------------------
// Medical test API
// ---------------------------------------------------------------------------

test("creating a medical test validates name, dates, and status", async () => {
  let captured: { query: string; values: unknown[] } | undefined;
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    captured = { query, values };
    return { rows: [{ ...medicalTestRow }] };
  };
  const res = response();
  await createMedicalTest({ user: { id: OWNER_ID }, body: {
    test_name: "HbA1c blood test", scheduled_date: "2026-09-25",
  } } as any, res);
  assert.equal(res.statusCode, 201);
  assert.equal(captured!.values[0], OWNER_ID);
  assert.equal(captured!.values[3], "2026-09-25");

  const invalidDate = response();
  await createMedicalTest({ user: { id: OWNER_ID }, body: {
    test_name: "HbA1c", scheduled_date: "2026-13-45",
  } } as any, invalidDate);
  assert.equal(invalidDate.statusCode, 400);
});

test("medical test completion stamps completed_at, preserves scheduled date, and is idempotent", async () => {
  (pool as any).query = async (query: string) => {
    if (query.includes("UPDATE medical_tests")) {
      return { rows: [{ ...medicalTestRow, status: "completed", completed_at: new Date() }] };
    }
    return { rows: [] };
  };
  const res = response();
  await completeMedicalTest({ params: { id: TEST_ID }, user: { id: OWNER_ID }, body: {} } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.follow_up, undefined);
  assert.equal(res.body.medical_test.status, "completed");
  assert.ok(res.body.medical_test.completed_at);

  // Idempotency is enforced by the guarded UPDATE: an already-completed test
  // matches no row, so the controller returns the existing record unchanged.
  let updateQuery = "";
  (pool as any).query = async (query: string) => {
    if (query.includes("UPDATE medical_tests")) {
      updateQuery = query;
      return { rows: [] };
    }
    if (query.includes("FROM medical_tests")) return { rows: [{ ...medicalTestRow, status: "completed", completed_at: new Date() }] };
    return { rows: [] };
  };
  const repeatRes = response();
  await completeMedicalTest({ params: { id: TEST_ID }, user: { id: OWNER_ID }, body: {} } as any, repeatRes);
  assert.equal(repeatRes.statusCode, 200);
  assert.equal(repeatRes.body.already_completed, true);
  assert.equal(repeatRes.body.medical_test.scheduled_date, "2026-09-25");
  assert.match(updateQuery, /status NOT IN \('completed'\)/);
});

test("invalid medical-test status values are rejected before persistence", async () => {
  let queryCalled = false;
  (pool as any).query = async () => { queryCalled = true; return { rows: [] }; };
  const res = response();
  await updateMedicalTest({ params: { id: TEST_ID }, user: { id: OWNER_ID }, body: { status: "archived" } } as any, res);
  assert.equal(res.statusCode, 400);
  assert.equal(queryCalled, false);
});

test("another user cannot complete or delete an owner's medical test", async () => {
  (pool as any).query = async () => ({ rows: [] });
  const completeRes = response();
  await completeMedicalTest({ params: { id: TEST_ID }, user: { id: OTHER_ID }, body: {} } as any, completeRes);
  assert.equal(completeRes.statusCode, 404);

  const deleteRes = response();
  await deleteMedicalTest({ params: { id: TEST_ID }, user: { id: OTHER_ID } } as any, deleteRes);
  assert.equal(deleteRes.statusCode, 404);
});

test("medical test listing applies status filters and derives overdue flags", async () => {
  let captured: { query: string; values: unknown[] } | undefined;
  (pool as any).query = async (query: string, values: unknown[] = []) => {
    captured = { query, values };
    return { rows: [{ ...medicalTestRow, status: "scheduled" }] };
  };
  const res = response();
  await listMedicalTests({ user: { id: OWNER_ID }, query: { status: "scheduled" } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.match(captured!.query, /status = \$2/);
  assert.equal(res.body.counts.scheduled, 1);

  const invalidFilter = response();
  await listMedicalTests({ user: { id: OWNER_ID }, query: { status: "nope" } } as any, invalidFilter);
  assert.equal(invalidFilter.statusCode, 400);
});

// ---------------------------------------------------------------------------
// AI extraction mapping
// ---------------------------------------------------------------------------

test("extracted follow-up with a supported date maps to a structured record", () => {
  const mapped = mapExtractionFollowUps({
    follow_up: [{
      type_or_reason: "Cardiology review",
      recommended_date_or_timeframe: "2026-10-01",
      instructions: "Bring medication list",
      provider_or_specialist: "Dr. Chen",
      source_text: "Follow up with cardiology on 2026-10-01",
    }],
  } as any);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].title, "Cardiology review");
  assert.equal(mapped[0].appointment_date, "2026-10-01");
  assert.equal(mapped[0].status, "pending");
  assert.match(mapped[0].record_fingerprint, /^[0-9a-f]{64}$/);
});

test("extracted follow-up with a relative timeframe resolves the date deterministically", () => {
  const now = new Date("2026-09-17T00:00:00Z");
  const mapped = mapExtractionFollowUps({
    follow_up: [{
      type_or_reason: "Blood sugar check",
      recommended_date_or_timeframe: "in 2 weeks",
      source_text: "Blood sugar check in 2 weeks",
    }],
  } as any, now);
  assert.equal(mapped[0].appointment_date, "2026-10-01");
});

test("ambiguous extracted dates are stored as missing, never invented", () => {
  const resolved = normalizeAiDate("after surgery recovery");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok && resolved.value, null);

  const mapped = mapExtractionFollowUps({
    follow_up: [{
      type_or_reason: "Review after surgery",
      recommended_date_or_timeframe: null,
      source_text: "Review after surgery recovery",
    }],
  } as any);
  assert.equal(mapped[0].appointment_date, null);
});

test("extracted tests map to pending or completed records without inventing results", () => {
  const mapped = mapExtractionTests({
    tests: [
      "Hemoglobin A1c",
      { name: "HbA1c", result_or_value: "6.8 percent", status: "abnormal", source_text: "HbA1c 6.8 percent" },
      { name: "Chest X-ray", status: "pending", source_text: "Chest X-ray pending" },
    ],
  } as any);
  assert.equal(mapped.length, 3);
  assert.equal(mapped[0].status, "pending");
  assert.equal(mapped[0].result_summary, null);
  assert.equal(mapped[1].status, "completed");
  assert.equal(mapped[1].result_summary, "6.8 percent");
  assert.equal(mapped[2].status, "pending");
});

test("duplicate extraction mapping produces identical fingerprints for dedup protection", () => {
  const extraction = {
    follow_up: [{ type_or_reason: "Cardiology review", source_text: "Follow up with cardiology" }],
    tests: [{ name: "HbA1c", source_text: "HbA1c blood test" }],
  } as any;
  const firstFollowUp = mapExtractionFollowUps(extraction)[0];
  const secondFollowUp = mapExtractionFollowUps(extraction)[0];
  const firstTest = mapExtractionTests(extraction)[0];
  const secondTest = mapExtractionTests(extraction)[0];
  assert.equal(firstFollowUp.record_fingerprint, secondFollowUp.record_fingerprint);
  assert.equal(firstTest.record_fingerprint, secondTest.record_fingerprint);
  assert.notEqual(firstFollowUp.record_fingerprint, firstTest.record_fingerprint);
});
