import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import { confirmDocumentAnalysis } from "../src/controllers/analysisController";
import { authenticateToken } from "../src/middlewares/authMiddleware";
import { MEDICAL_DISCLAIMER } from "../src/services/aiExtractionService";

const originalQuery = pool.query.bind(pool);

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
  await pool.end();
});

test("authenticated owners can confirm and persist reviewed care-plan data", async () => {
  let queryText = "";
  let queryValues: unknown[] = [];
  const extraction = reviewedExtraction();

  (pool as any).query = async (query: string, values: unknown[]) => {
    queryText = query;
    queryValues = values;
    return {
      rows: [{
        document_id: "document-a",
        verified_extraction: extraction,
        disclaimer: MEDICAL_DISCLAIMER,
        confirmed_at: new Date("2026-09-12T00:00:00.000Z"),
      }],
    };
  };

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: "document-a" },
    user: { id: "user-a" },
    body: { extraction },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.document_id, "document-a");
  assert.deepEqual(res.body.care_plan, extraction);
  assert.equal(res.body.disclaimer, MEDICAL_DISCLAIMER);
  assert.match(queryText, /INSERT INTO verified_care_plans/);
  assert.match(queryText, /WHERE id = \$1\s+AND user_id = \$2/);
  assert.equal(queryValues[0], "document-a");
  assert.equal(queryValues[1], "user-a");
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
  return confirmDocumentAnalysis({ params: { id: "document-a" }, body: {} } as any, controllerResponse)
    .then(() => {
      assert.equal(controllerResponse.statusCode, 401);
    });
});

test("non-owners cannot confirm another user's document", async () => {
  (pool as any).query = async () => ({ rows: [] });

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: "document-a" },
    user: { id: "user-b" },
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
    params: { id: "document-a" },
    user: { id: "user-a" },
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
    params: { id: "document-a" },
    user: { id: "user-a" },
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
      document_id: "document-a",
      verified_extraction: extraction,
      disclaimer: MEDICAL_DISCLAIMER,
      confirmed_at: new Date(),
    }],
  });

  const res = createResponse();
  await confirmDocumentAnalysis({
    params: { id: "document-a" },
    user: { id: "user-a" },
    body: { extraction },
  } as any, res);

  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(res.body), /raw OCR text|private-storage-key|storage_key/i);
});
