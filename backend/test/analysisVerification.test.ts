import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import {
    confirmDocumentAnalysis,
    getVerificationAuditHistory,
    getVerificationVersions,
    getVerifiedCarePlan,
    syncVerifiedCarePlanTrackers,
} from "../src/controllers/analysisController";
import { authenticateToken } from "../src/middlewares/authMiddleware";
import { MEDICAL_DISCLAIMER } from "../src/services/aiExtractionService";

const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const CARE_PLAN_ID = "44444444-4444-4444-8444-444444444444";

(pool as any).connect = async () => ({
  query: (...args: Parameters<typeof pool.query>) => pool.query(...args),
  release: () => undefined,
});

const createResponse = () => {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  return response;
};

const reviewedExtraction = () => ({
  medications: ["Metformin 500 mg twice daily"],
  findings: [],
  tests: ["Hemoglobin A1c"],
  follow_up: ["Follow up in two weeks"],
  warnings: [],
  patient_summary: "The reviewed information lists metformin and Hemoglobin A1c.",
  uncertainty_notes: [],
});

after(async () => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  await pool.end();
});

test("authenticated owners can confirm and persist reviewed care-plan data", async () => {
  let queryText = "";
  let queryValues: unknown[] = [];
  const extraction = reviewedExtraction();

  (pool as any).query = async (query: string, values: unknown[]) => {
    if (query.includes("SELECT extracted_text FROM medical_documents")) {
      return { rows: [{ extracted_text: null }] };
    }

    if (query.includes("INSERT INTO verified_care_plans")) {
      queryText = query;
      queryValues = values;
      return {
        rows: [{
          id: CARE_PLAN_ID,
          document_id: DOCUMENT_ID,
          user_id: OWNER_USER_ID,
          verified_extraction: extraction,
          disclaimer: MEDICAL_DISCLAIMER,
          confirmed_at: new Date("2026-09-12T00:00:00.000Z"),
          updated_at: new Date("2026-09-12T00:00:00.000Z"),
        }],
      };
    }

    if (query.includes("SELECT COALESCE(MAX(version_number)")) {
      return { rows: [{ next_version: 1 }] };
    }

    if (query.includes("INSERT INTO verified_care_plan_versions")) {
      return { rows: [{ version_number: 1 }] };
    }

    return { rows: [] };
  };

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: DOCUMENT_ID },
    user: { id: OWNER_USER_ID },
    body: { extraction },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.document_id, DOCUMENT_ID);
  assert.deepEqual(res.body.care_plan, extraction);
  assert.equal(res.body.disclaimer, MEDICAL_DISCLAIMER);
  assert.match(queryText, /INSERT INTO verified_care_plans/);
  assert.match(queryText, /WHERE id = \$1\s+AND user_id = \$2/);
  assert.equal(queryValues[0], DOCUMENT_ID);
  assert.equal(queryValues[1], OWNER_USER_ID);
  assert.deepEqual(JSON.parse(String(queryValues[2])), extraction);
  assert.equal(queryValues[3], MEDICAL_DISCLAIMER);
});

test("unauthenticated confirmation is rejected", () => {
  const middlewareResponse = createResponse();
  let nextCalled = false;

  authenticateToken({ headers: {} } as any, middlewareResponse, () => {
    nextCalled = true;
  });

  assert.equal(middlewareResponse.statusCode, 401);
  assert.equal(nextCalled, false);

  const controllerResponse = createResponse();
  return confirmDocumentAnalysis({ params: { id: DOCUMENT_ID }, body: {} } as any, controllerResponse)
    .then(() => {
      assert.equal(controllerResponse.statusCode, 401);
    });
});

test("non-owners cannot confirm another user's document", async () => {
  (pool as any).query = async () => ({ rows: [] });

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: DOCUMENT_ID },
    user: { id: OTHER_USER_ID },
    body: { extraction: reviewedExtraction() },
  } as any, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    success: false,
    message: "Medical document not found",
  });
});

test("invalid reviewed extraction data is rejected before persistence", async () => {
  let queryCalled = false;
  (pool as any).query = async () => {
    queryCalled = true;
    return { rows: [] };
  };

  const invalidExtraction = reviewedExtraction();
  delete (invalidExtraction as Partial<typeof invalidExtraction>).patient_summary;

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: DOCUMENT_ID },
    user: { id: OWNER_USER_ID },
    body: { extraction: invalidExtraction },
  } as any, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid reviewed extraction data");
  assert.equal(queryCalled, false);
});

test("over-limit reviewed extraction data is rejected before persistence", async () => {
  let queryCalled = false;
  (pool as any).query = async () => {
    queryCalled = true;
    return { rows: [] };
  };

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: DOCUMENT_ID },
    user: { id: OWNER_USER_ID },
    body: {
      extraction: {
        ...reviewedExtraction(),
        warnings: Array.from({ length: 11 }, (_, index) => `Warning ${index + 1}`),
      },
    },
  } as any, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid reviewed extraction data");
  assert.equal(queryCalled, false);
});

test("confirmation responses never include raw document text or private storage references", async () => {
  const extraction = reviewedExtraction();
  (pool as any).query = async () => ({
    rows: [{
      document_id: DOCUMENT_ID,
      verified_extraction: extraction,
      disclaimer: MEDICAL_DISCLAIMER,
      confirmed_at: new Date(),
    }],
  });

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: DOCUMENT_ID },
    user: { id: OWNER_USER_ID },
    body: { extraction },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(res.body), /raw OCR text|private-storage-key|storage_key/i);
});

test("owner can retrieve the current verified care plan with version metadata", async () => {
  const extraction = {
    medications: [{
      name: "Metformin",
      dosage: "500 mg",
      frequency: "twice daily",
      route: "oral",
      duration: "ongoing",
      source_text: "Metformin 500 mg twice daily",
    }],
    findings: ["Type 2 diabetes"],
    tests: [],
    follow_up: [{
      type_or_reason: "Blood sugar check",
      recommended_date_or_timeframe: "2026-09-20",
      status: "recommended",
      source_text: "Blood sugar check on 2026-09-20",
    }],
    warnings: [],
    patient_summary: "Stable summary.",
    uncertainty_notes: [],
  };

  (pool as any).query = async (query: string, values: unknown[]) => {
    if (query.includes("FROM verified_care_plans")) {
      return {
        rows: [{
          id: CARE_PLAN_ID,
          document_id: DOCUMENT_ID,
          user_id: OWNER_USER_ID,
          verified_extraction: extraction,
          disclaimer: MEDICAL_DISCLAIMER,
          confirmed_at: new Date("2026-09-12T00:00:00.000Z"),
          updated_at: new Date("2026-09-14T00:00:00.000Z"),
          version_number: 2,
          is_current: true,
          clinician_review_status: "approved",
        }],
      };
    }

    return { rows: [] };
  };

  const res = createResponse();
  await getVerifiedCarePlan({ params: { documentId: DOCUMENT_ID }, user: { id: OWNER_USER_ID } } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.plan.document_id, DOCUMENT_ID);
  assert.equal(res.body.plan.version_number, 2);
  assert.equal(res.body.plan.current_version, true);
  assert.equal(res.body.plan.clinician_review_status, "approved");
  assert.deepEqual(res.body.plan.verified_extraction.medications[0].name, "Metformin");
  assert.equal(res.body.plan.disclaimer, MEDICAL_DISCLAIMER);
});

test("owner can retrieve version history with the documentId route parameter", async () => {
  (pool as any).query = async () => ({
    rows: [{
      id: "version-1",
      version_number: 1,
      verified_extraction: { medications: [] },
      disclaimer: MEDICAL_DISCLAIMER,
      confirmed_at: new Date("2026-09-12T00:00:00.000Z"),
      created_at: new Date("2026-09-12T00:00:00.000Z"),
      is_current: true,
    }],
  });

  const res = createResponse();
  await getVerificationVersions({
    params: { documentId: DOCUMENT_ID },
    user: { id: OWNER_USER_ID },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.versions[0].version_number, 1);
});

test("owner can retrieve audit history with the documentId route parameter", async () => {
  (pool as any).query = async () => ({
    rows: [{
      id: "event-1",
      action: "confirmed",
      metadata: { version_number: 1 },
      created_at: new Date("2026-09-12T00:00:00.000Z"),
    }],
  });

  const res = createResponse();
  await getVerificationAuditHistory({
    params: { documentId: DOCUMENT_ID },
    user: { id: OWNER_USER_ID },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.events[0].action, "confirmed");
});

test("re-confirmation produces a single medication and follow-up tracker set", async () => {
  const extraction = {
    medications: [{
      name: "Metformin",
      dosage: "500 mg",
      frequency: "twice daily",
      route: "oral",
      duration: "ongoing",
      source_text: "Metformin 500 mg twice daily",
    }],
    findings: [],
    tests: [],
    follow_up: [{
      type_or_reason: "Blood sugar check",
      recommended_date_or_timeframe: "2026-09-20",
      status: "recommended",
      source_text: "Blood sugar check on 2026-09-20",
    }],
    warnings: [],
    patient_summary: "Stable summary.",
    uncertainty_notes: [],
  };

  const inserts: Array<{ sql: string; values: unknown[] }> = [];
  (pool as any).query = async (query: string, values: unknown[]) => {
    inserts.push({ sql: query, values });
    if (query.includes("DELETE FROM medication_tracker_records") || query.includes("DELETE FROM follow_up_tracker_records")) {
      return { rows: [] };
    }
    if (query.includes("INSERT INTO medication_tracker_records") || query.includes("INSERT INTO follow_up_tracker_records")) {
      return { rows: [] };
    }
    return { rows: [] };
  };

  await syncVerifiedCarePlanTrackers({
    id: CARE_PLAN_ID,
    user_id: OWNER_USER_ID,
    document_id: DOCUMENT_ID,
    verified_extraction: extraction,
  } as any, OWNER_USER_ID);

  assert.equal(inserts.filter((entry) => entry.sql.includes("DELETE FROM medication_tracker_records")).length, 1);
  assert.equal(inserts.filter((entry) => entry.sql.includes("INSERT INTO medication_tracker_records")).length, 1);
  assert.equal(inserts.filter((entry) => entry.sql.includes("DELETE FROM follow_up_tracker_records")).length, 1);
  assert.equal(inserts.filter((entry) => entry.sql.includes("INSERT INTO follow_up_tracker_records")).length, 1);
});
