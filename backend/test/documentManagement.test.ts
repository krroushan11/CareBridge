import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import {
    deleteDocument,
    downloadDocument,
    extractStructuredDocument,
    getDocumentProcessingStatus,
    listDocuments,
    updateDocumentMetadata,
    uploadDocument,
} from "../src/controllers/documentController";
import { authenticateToken } from "../src/middlewares/authMiddleware";
import { getPrivateDocumentPath } from "../src/middlewares/documentUploadMiddleware";
import { MAX_DOCUMENT_SIZE_BYTES } from "../src/middlewares/documentUploadMiddleware";
import {
    emptyStructuredExtractionOutput,
    extractStructuredInformation,
    MEDICAL_DISCLAIMER,
    resetLlmProvider,
    setLlmProviderForTests,
    validateStructuredExtractionOutput,
} from "../src/services/aiExtractionService";
import { persistDraftCarePlan } from "../src/services/draftCarePlanService";
import { createConfiguredLlmProvider } from "../src/services/llmProvider";
import {
  extractMedicalDocumentText,
  getConfiguredOcrLanguages,
  MAX_PROCESSING_ATTEMPTS,
  OcrLanguageError,
  processMedicalDocument,
} from "../src/services/documentExtractionService";
import { processQueuedDocuments } from "../src/services/documentProcessingQueue";

const ownedDocumentId = "11111111-1111-4111-8111-111111111111";

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

const setQueryMock = (
  handler: (query: string, values: unknown[]) => Promise<{ rows: unknown[] }>
) => {
  (pool as any).query = (query: string, values: unknown[]) =>
    handler(query, values);
};

const createDocumentFile = async (content: Buffer, overrides: Record<string, unknown> = {}) => {
  const directory = await mkdtemp(join(tmpdir(), "carebridge-document-test-"));
  const path = join(directory, "document.pdf");
  await writeFile(path, content);

  return {
    directory,
    file: {
      path,
      filename: "private-storage-key.pdf",
      originalname: "medical-record.pdf",
      mimetype: "application/pdf",
      size: content.length,
      ...overrides,
    } as Express.Multer.File,
  };
};

const validPatientFacingOutput = () => ({
  medications: [],
  findings: [],
  tests: [],
  follow_up: [],
  warnings: [],
  patient_summary: "No document-derived medical information is available.",
  uncertainty_notes: [],
});

after(async () => {
  (pool as any).query = originalQuery;
  resetLlmProvider();
  await pool.end();
});

test("authenticated upload stores private metadata for the authenticated user", async () => {
  const { directory, file } = await createDocumentFile(Buffer.from("%PDF-1.7\n"));
  let insertValues: unknown[] = [];

  setQueryMock(async (query, values) => {
    assert.match(query, /INSERT INTO medical_documents/);
    insertValues = values;
    return {
      rows: [{
        id: "document-id",
        original_filename: "medical-record.pdf",
        mime_type: "application/pdf",
        file_size: file.size,
        processing_status: "uploaded",
        created_at: new Date(),
      }],
    };
  });

  const res = createResponse();
  await uploadDocument({ user: { id: "user-a" }, file } as any, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(insertValues[0], "user-a");
  assert.equal(insertValues[2], file.filename);
  assert.equal(res.body.document.storage_key, undefined);
  await rm(directory, { recursive: true, force: true });
});

test("unauthenticated upload is rejected by authentication middleware", () => {
  const res = createResponse();
  let nextCalled = false;

  authenticateToken({ headers: {} } as any, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.equal(nextCalled, false);
});

test("invalid medical document type is rejected", async () => {
  const { directory, file } = await createDocumentFile(Buffer.from("not a document"), {
    originalname: "medical-record.txt",
    mimetype: "text/plain",
  });

  const res = createResponse();
  await uploadDocument({ user: { id: "user-a" }, file } as any, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  await rm(directory, { recursive: true, force: true });
});

test("oversized medical document is rejected", async () => {
  const { directory, file } = await createDocumentFile(Buffer.from("%PDF-1.7\n"), {
    size: MAX_DOCUMENT_SIZE_BYTES + 1,
  });

  const res = createResponse();
  await uploadDocument({ user: { id: "user-a" }, file } as any, res);

  assert.equal(res.statusCode, 413);
  assert.equal(res.body.success, false);
  await rm(directory, { recursive: true, force: true });
});

test("authenticated document listing is scoped to the requesting user", async () => {
  let listQuery = "";
  let listValues: unknown[] = [];

  setQueryMock(async (query, values) => {
    listQuery = query;
    listValues = values;
    return {
      rows: [{
        id: "document-a",
        original_filename: "medical-record.pdf",
        mime_type: "application/pdf",
        file_size: 100,
        processing_status: "uploaded",
        created_at: new Date(),
      }],
    };
  });

  const res = createResponse();
  await listDocuments({ user: { id: "user-a" } } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(listValues[0], "user-a");
  assert.match(listQuery, /WHERE user_id = \$1/);
  assert.doesNotMatch(listQuery, /storage_key/);
});

test("owners can download private documents without exposing storage metadata", async () => {
  const storageKey = "phase4-download-test.pdf";
  const privatePath = getPrivateDocumentPath(storageKey);
  await writeFile(privatePath, "%PDF-1.7\n");
  let queryValues: unknown[] = [];
  const res = createResponse();
  let sentPath = "";
  let sentOptions: any;
  res.sendFile = (path: string, options: unknown, callback: () => void) => {
    sentPath = path;
    sentOptions = options;
    callback();
  };

  setQueryMock(async (_query, values) => {
    queryValues = values;
    return { rows: [{ storage_key: storageKey, mime_type: "application/pdf", original_filename: "record.pdf" }] };
  });

  await downloadDocument({ user: { id: "user-a" }, params: { id: ownedDocumentId } } as any, res);

  assert.deepEqual(queryValues, [ownedDocumentId, "user-a"]);
  assert.equal(sentPath, privatePath);
  assert.equal(sentOptions.headers["Content-Type"], "application/pdf");
  assert.match(sentOptions.headers["Content-Disposition"], /attachment/);
  await rm(privatePath, { force: true });
});

test("unauthenticated users cannot download a document", async () => {
  const res = createResponse();
  await downloadDocument({ params: { id: ownedDocumentId } } as any, res);
  assert.equal(res.statusCode, 401);
});

test("non-owners cannot download, update, delete, or inspect documents", async () => {
  setQueryMock(async () => ({ rows: [] }));

  for (const handler of [downloadDocument, getDocumentProcessingStatus, deleteDocument]) {
    const res = createResponse();
    if (handler === downloadDocument) res.sendFile = () => undefined;
    await handler({ user: { id: "user-b" }, params: { id: ownedDocumentId } } as any, res);
    assert.equal(res.statusCode, 404);
  }

  const updateRes = createResponse();
  await updateDocumentMetadata({
    user: { id: "user-b" },
    params: { id: ownedDocumentId },
    body: { original_filename: "renamed.pdf" },
  } as any, updateRes);
  assert.equal(updateRes.statusCode, 404);
});

test("owners can update safe document metadata and invalid names are rejected", async () => {
  let values: unknown[] = [];
  setQueryMock(async (_query, queryValues) => {
    values = queryValues;
    return { rows: [{ id: ownedDocumentId, original_filename: "renamed.pdf", processing_status: "uploaded" }] };
  });

  const res = createResponse();
  await updateDocumentMetadata({
    user: { id: "user-a" },
    params: { id: ownedDocumentId },
    body: { original_filename: "renamed.pdf" },
  } as any, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(values, ["renamed.pdf", ownedDocumentId, "user-a"]);

  const invalidRes = createResponse();
  await updateDocumentMetadata({
    user: { id: "user-a" },
    params: { id: ownedDocumentId },
    body: { original_filename: "../unsafe.pdf" },
  } as any, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
});

test("owners can retrieve safe processing status", async () => {
  setQueryMock(async () => ({
    rows: [{
      id: ownedDocumentId,
      processing_status: "uploaded",
      processing_attempts: 1,
      processing_error: "internal database detail",
    }],
  }));
  const res = createResponse();
  await getDocumentProcessingStatus({ user: { id: "user-a" }, params: { id: ownedDocumentId } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.document.id, ownedDocumentId);
  assert.equal(res.body.document.storage_key, undefined);
  assert.equal(res.body.document.processing_error, null);
});

test("owners can delete their private document after an owner-scoped database lookup", async () => {
  const storageKey = "phase4-delete-test.pdf";
  const privatePath = getPrivateDocumentPath(storageKey);
  await writeFile(privatePath, "%PDF-1.7\n");
  let queries = 0;
  setQueryMock(async (_query, values) => {
    queries += 1;
    assert.deepEqual(values, [ownedDocumentId, "user-a"]);
    return queries === 1 ? { rows: [{ storage_key: storageKey }] } : { rows: [{ id: ownedDocumentId }] };
  });

  const res = createResponse();
  await deleteDocument({ user: { id: "user-a" }, params: { id: ownedDocumentId } } as any, res);
  assert.equal(res.statusCode, 200);
  await assert.rejects(() => access(privatePath));
});

test("processMedicalDocument stores normalized text and deterministic completed metadata", async () => {
  let firstUpdateSeen = false;
  let secondUpdateSeen = false;
  let secondValues: unknown[] = [];

  setQueryMock(async (query, values) => {
    if (query.startsWith("UPDATE medical_documents\n       SET processing_status = 'processing'")) {
      firstUpdateSeen = true;
      return { rows: [{ id: "document-a" }] };
    }

    if (query.startsWith("UPDATE medical_documents\n       SET extracted_text = $1")) {
      secondUpdateSeen = true;
      secondValues = values;
      return { rows: [{ id: "document-a" }] };
    }

    return { rows: [] };
  });

  await processMedicalDocument(
    {
      id: "document-a",
      userId: "user-a",
      storageKey: "private-storage-key.pdf",
      mimeType: "application/pdf",
    },
    async () => ({ text: "Hello   world   from  PDF\n", method: "pdf_text" })
  );

  assert.equal(firstUpdateSeen, true);
  assert.equal(secondUpdateSeen, true);
  assert.equal(secondValues[0], "Hello world from PDF");
  assert.equal(secondValues[1], "pdf_text");
  assert.equal(secondValues[2], "document-a");
  assert.equal(secondValues[3], "user-a");
});

test("transient processing failures are requeued with bounded retry metadata", async () => {
  let retryValues: unknown[] = [];
  setQueryMock(async (query, values) => {
    if (query.includes("RETURNING id, processing_attempts")) return { rows: [{ id: ownedDocumentId, processing_attempts: 1 }] };
    if (query.includes("processing_retry_scheduled")) {
      retryValues = values;
      return { rows: [{ id: ownedDocumentId }] };
    }
    return { rows: [] };
  });

  await processMedicalDocument(
    { id: ownedDocumentId, userId: "user-a", storageKey: "missing.pdf", mimeType: "application/pdf" },
    async () => { throw new Error("temporary OCR timeout"); }
  );

  assert.equal(retryValues[1], ownedDocumentId);
  assert.equal(retryValues[2], "user-a");
});

test("processing is marked failed after the retry limit", async () => {
  let failed = false;
  setQueryMock(async (query) => {
    if (query.includes("RETURNING id, processing_attempts")) {
      return { rows: [{ id: ownedDocumentId, processing_attempts: MAX_PROCESSING_ATTEMPTS }] };
    }
    if (query.includes("processing_status = 'failed'")) {
      failed = true;
    }
    return { rows: [] };
  });

  await processMedicalDocument(
    { id: ownedDocumentId, userId: "user-a", storageKey: "missing.pdf", mimeType: "application/pdf" },
    async () => { throw new Error("temporary OCR timeout"); }
  );

  assert.equal(failed, true);
});

test("OCR language configuration supports multiple languages and defaults to English", async () => {
  const originalLanguages = process.env.OCR_LANGUAGES;
  process.env.OCR_LANGUAGES = "eng,spa";
  assert.equal(getConfiguredOcrLanguages(), "eng+spa");

  let languagesUsed = "";
  const result = await extractMedicalDocumentText(
    "unused.png",
    "image/png",
    {
      extractPdfText: async () => "",
      renderPdfPages: async () => [],
      extractImageText: async (_image, languages) => {
        languagesUsed = languages || "";
        return " Texto en español ";
      },
    }
  );

  assert.equal(languagesUsed, "eng+spa");
  assert.deepEqual(result, { text: "Texto en español", method: "ocr" });

  if (originalLanguages === undefined) delete process.env.OCR_LANGUAGES;
  else process.env.OCR_LANGUAGES = originalLanguages;
});

test("invalid OCR language configuration fails clearly", () => {
  const originalLanguages = process.env.OCR_LANGUAGES;
  process.env.OCR_LANGUAGES = "eng,invalid language";
  assert.throws(() => getConfiguredOcrLanguages(), OcrLanguageError);

  if (originalLanguages === undefined) delete process.env.OCR_LANGUAGES;
  else process.env.OCR_LANGUAGES = originalLanguages;
});

test("background queue claims and completes a document without duplicate processing", async () => {
  const originalConnect = (pool as any).connect;
  const originalPoolQuery = (pool as any).query;
  let clientQueries = 0;
  let extractionQueries = 0;

  (pool as any).connect = async () => ({
    query: async (query: string) => {
      clientQueries += 1;
      if (query === "BEGIN" || query === "COMMIT") return { rows: [] };
      if (query.includes("WITH candidates")) {
        return {
          rows: [{
            id: ownedDocumentId,
            user_id: "user-a",
            storage_key: "queued.pdf",
            mime_type: "application/pdf",
            processing_attempts: 1,
          }],
        };
      }
      if (query.includes("UPDATE medical_documents")) return { rows: [] };
      return { rows: [] };
    },
    release: () => undefined,
  });
  (pool as any).query = async (query: string) => {
    if (query.includes("SET extracted_text")) extractionQueries += 1;
    return { rows: [] };
  };

  await processQueuedDocuments(1, async () => ({
    text: "Queued document text",
    method: "pdf_text",
  }));

  assert.equal(clientQueries >= 3, true);
  assert.equal(extractionQueries, 1);
  (pool as any).connect = originalConnect;
  (pool as any).query = originalPoolQuery;
});

test("background queue includes stale processing recovery before claiming jobs", async () => {
  const originalConnect = (pool as any).connect;
  let staleRecoveryQuery = "";

  (pool as any).connect = async () => ({
    query: async (query: string) => {
      if (query === "BEGIN" || query === "COMMIT") return { rows: [] };
      if (query.includes("processing_started_at < NOW() - INTERVAL '15 minutes'")) {
        staleRecoveryQuery = query;
      }
      return { rows: [] };
    },
    release: () => undefined,
  });

  await processQueuedDocuments(1);

  assert.match(staleRecoveryQuery, /processing_status = 'processing'/);
  assert.match(staleRecoveryQuery, /processing_attempts >= 3/);
  (pool as any).connect = originalConnect;
});

test("processMedicalDocument marks a row failed when extraction cannot produce normalized text", async () => {
  let updateFailureSeen = false;
  let failureValues: unknown[] = [];

  setQueryMock(async (query, values) => {
    if (query.startsWith("UPDATE medical_documents\n       SET processing_status = 'processing'")) {
      return { rows: [{ id: "document-failed" }] };
    }

    if (query.startsWith("UPDATE medical_documents\n       SET extracted_text = NULL,")) {
      updateFailureSeen = true;
      failureValues = values;
      return { rows: [{ id: "document-failed" }] };
    }

    return { rows: [] };
  });

  await processMedicalDocument(
    {
      id: "document-failed",
      userId: "user-a",
      storageKey: "private-storage-key.pdf",
      mimeType: "application/pdf",
    },
    async () => {
      throw new Error("No usable text found");
    }
  );

  assert.equal(updateFailureSeen, true);
  assert.equal(failureValues[0], "document-failed");
  assert.equal(failureValues[1], "user-a");
});

test("LLM extraction returns the strict empty structure for empty/no-category input", async () => {
  let providerCalled = false;
  setLlmProviderForTests({
    async extract() {
      providerCalled = true;
      return {};
    },
  });

  const output = await extractStructuredInformation("");

  assert.deepEqual(output, emptyStructuredExtractionOutput());
  assert.equal(providerCalled, false);
});

test("LLM extraction returns validated structured output", async () => {
  let receivedText = "";
  setLlmProviderForTests({
    async extract(normalizedText) {
      receivedText = normalizedText;
      return {
        medications: ["Metformin 500 mg twice daily"],
        findings: [],
        tests: ["Hemoglobin A1c"],
        follow_up: [],
        warnings: [],
        patient_summary: "The document lists metformin and Hemoglobin A1c.",
        uncertainty_notes: [],
      };
    },
  });

  const output = await extractStructuredInformation(
    "  Metformin 500 mg twice daily. Hemoglobin A1c.\n"
  );

  assert.equal(receivedText, "Metformin 500 mg twice daily. Hemoglobin A1c.");
  assert.deepEqual(output.medications, ["Metformin 500 mg twice daily"]);
  assert.deepEqual(output.tests, ["Hemoglobin A1c"]);
  assert.equal(output.patient_summary, "The document lists metformin and Hemoglobin A1c.");
});

test("LLM extraction accepts a patient-friendly summary while facts remain source-supported", async () => {
  setLlmProviderForTests({
    async extract() {
      return {
        ...validPatientFacingOutput(),
        medications: ["Metformin 500 mg twice daily"],
        patient_summary: "Your record lists metformin taken twice daily.",
      };
    },
  });

  const output = await extractStructuredInformation("Metformin 500 mg twice daily.");

  assert.equal(output.patient_summary, "Your record lists metformin taken twice daily.");
});

test("LLM extraction rejects malformed provider output", async () => {
  setLlmProviderForTests({
    async extract() {
      return {
        medications: ["Metformin"],
        findings: [],
        tests: [],
        warnings: [],
        patient_summary: "Medication information is present.",
        uncertainty_notes: [],
      };
    },
  });

  await assert.rejects(
    extractStructuredInformation("Medication: Metformin"),
    /Invalid structured extraction output/
  );
});

test("LLM extraction rejects unexpected provider fields", async () => {
  setLlmProviderForTests({
    async extract() {
      return {
        medications: [],
        findings: [],
        tests: [],
        follow_up: [],
        warnings: [],
        diagnosis: ["not allowed"],
        patient_summary: "No document-derived medical information is available.",
        uncertainty_notes: [],
      };
    },
  });

  await assert.rejects(
    extractStructuredInformation("Diagnosis: unsupported"),
    /Invalid structured extraction output/
  );
});

test("Gemini provider requests strict structured JSON and parses valid output", async () => {
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  const originalModel = process.env.AI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
  process.env.AI_MODEL = "gemini-3.6-flash";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            medications: ["Metformin"],
            findings: [],
            tests: [],
            follow_up: [],
            warnings: [],
            patient_summary: "The document lists metformin.",
            uncertainty_notes: [],
          }),
        },
      }],
    }), { status: 200 });
  };

  try {
    const output = await createConfiguredLlmProvider().extract("Medication: Metformin");
    assert.deepEqual(output, {
      medications: ["Metformin"],
      findings: [],
      tests: [],
      follow_up: [],
      warnings: [],
      patient_summary: "The document lists metformin.",
      uncertainty_notes: [],
    });
    assert.deepEqual(requestBody?.response_format, {
      type: "json_schema",
      json_schema: {
        name: "medical_document_extraction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            medications: { type: "array", items: { type: ["string", "object"] } },
            findings: { type: "array", items: { type: "string" } },
            tests: {
              type: "array",
              items: {
                anyOf: [
                  { type: "string", minLength: 1, maxLength: 300 },
                  {
                    type: "object",
                    properties: {
                      name: { type: "string", minLength: 1, maxLength: 300 },
                      result_or_value: { type: ["string", "null"], minLength: 1, maxLength: 300 },
                      status: {
                        type: ["string", "null"],
                        enum: ["normal", "abnormal", "positive", "negative", "pending", "not_available", null],
                      },
                      source_text: { type: ["string", "null"], minLength: 1, maxLength: 300 },
                    },
                    required: ["name"],
                    additionalProperties: false,
                  },
                ],
              },
            },
            follow_up: { type: "array", items: { type: ["string", "object"] } },
            warnings: { type: "array", items: { type: "string" } },
            patient_summary: { type: "string" },
            uncertainty_notes: { type: "array", items: { type: "string" } },
          },
          required: [
            "medications",
            "findings",
            "tests",
            "follow_up",
            "warnings",
            "patient_summary",
            "uncertainty_notes",
          ],
          additionalProperties: false,
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalModel;
  }
});

test("Gemini provider rejects malformed structured JSON", async () => {
  const originalApiKey = process.env.AI_API_KEY;
  const originalBaseUrl = process.env.AI_BASE_URL;
  const originalModel = process.env.AI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.AI_API_KEY = "test-key";
  process.env.AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
  process.env.AI_MODEL = "gemini-3.6-flash";
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: "not json" } }],
  }), { status: 200 });

  try {
    await assert.rejects(
      createConfiguredLlmProvider().extract("Medication: Metformin"),
      /malformed JSON/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalModel;
  }
});

test("LLM provider failure is handled without exposing document content", async () => {
  setLlmProviderForTests({
    async extract() {
      throw new Error("provider failure");
    },
  });

  await assert.rejects(
    extractStructuredInformation("Sensitive raw OCR text"),
    /Structured extraction provider unavailable/
  );
});

test("schema validator accepts valid structured output", () => {
  const result = validateStructuredExtractionOutput({
    medications: ["Ibuprofen 200mg"],
    findings: ["Blood pressure improved"],
    tests: ["CBC"],
    follow_up: ["Return in two weeks"],
    warnings: ["Use caution with NSAIDs"],
    patient_summary: "The document lists a CBC test and follow-up instructions.",
    uncertainty_notes: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, {
      medications: ["Ibuprofen 200mg"],
      findings: ["Blood pressure improved"],
      tests: ["CBC"],
      follow_up: ["Return in two weeks"],
      warnings: ["Use caution with NSAIDs"],
      patient_summary: "The document lists a CBC test and follow-up instructions.",
      uncertainty_notes: [],
    });
  }
});

test("schema validator rejects output when a category is missing", () => {
  const result = validateStructuredExtractionOutput({
    medications: [],
    findings: [],
    tests: [],
    warnings: [],
    patient_summary: "No document-derived medical information is available.",
    uncertainty_notes: [],
  } as any);

  assert.equal(result.ok, false);
});

test("schema validator rejects output when an unknown category is returned", () => {
  const result = validateStructuredExtractionOutput({
    medications: [],
    findings: [],
    tests: [],
    follow_up: [],
    warnings: [],
    diagnosis: ["should be rejected"],
    patient_summary: "No document-derived medical information is available.",
    uncertainty_notes: [],
  } as any);

  assert.equal(result.ok, false);
});

test("schema validator rejects missing or invalid patient summaries", () => {
  const missingSummary = validateStructuredExtractionOutput({
    medications: [], findings: [], tests: [], follow_up: [], warnings: [], uncertainty_notes: [],
  });
  const invalidSummary = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    patient_summary: "",
  });

  assert.equal(missingSummary.ok, false);
  assert.equal(invalidSummary.ok, false);
});

test("schema validator rejects overlong fact items and too many uncertainty notes", () => {
  const overlongFact = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    medications: ["x".repeat(301)],
  });
  const tooManyUncertaintyNotes = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    uncertainty_notes: Array.from({ length: 6 }, (_, index) => `Uncertainty ${index + 1}`),
  });

  assert.equal(overlongFact.ok, false);
  assert.equal(tooManyUncertaintyNotes.ok, false);
});

test("schema validator accepts supported structured medication fields", () => {
  const result = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    medications: [{
      name: "Metformin",
      dosage: "500 mg",
      frequency: "twice daily",
      duration: "30 days",
      route: "oral",
      source_text: "Metformin 500 mg twice daily for 30 days by mouth",
    }],
  });

  assert.equal(result.ok, true);
});

test("schema validator rejects invalid medication dosage, frequency, duration, and route", () => {
  for (const field of [
    ["dosage", "a lot"],
    ["frequency", "sometimes"],
    ["duration", "soon"],
    ["route", "telepathic"],
  ] as const) {
    const result = validateStructuredExtractionOutput({
      ...validPatientFacingOutput(),
      medications: [{ name: "Metformin", [field[0]]: field[1] }],
    });

    assert.equal(result.ok, false, `expected invalid ${field[0]} to be rejected`);
  }
});

test("schema validator accepts and rejects structured follow-up dates and statuses", () => {
  const valid = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    follow_up: [{
      type_or_reason: "routine review",
      recommended_date_or_timeframe: "2026-10-01",
      status: "scheduled",
      source_text: "Review scheduled for 2026-10-01",
    }],
  });
  const invalidDate = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    follow_up: [{ type_or_reason: "review", recommended_date_or_timeframe: "next Tuesday" }],
  });
  const invalidCalendarDate = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    follow_up: [{ type_or_reason: "review", recommended_date_or_timeframe: "2026-99-99" }],
  });
  const invalidStatus = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    follow_up: [{ type_or_reason: "review", status: "guessed" }],
  });

  assert.equal(valid.ok, true);
  assert.equal(invalidDate.ok, false);
  assert.equal(invalidCalendarDate.ok, false);
  assert.equal(invalidStatus.ok, false);
});

test("schema validator accepts structured test information and rejects malformed records", () => {
  const valid = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    tests: [{
      name: "Hemoglobin A1c",
      result_or_value: "6.5%",
      status: "abnormal",
      source_text: "Hemoglobin A1c 6.5%",
    }],
  });
  const invalid = validateStructuredExtractionOutput({
    ...validPatientFacingOutput(),
    tests: [{ name: "Hemoglobin A1c", result: "6.5%" }],
  });

  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
});

test("structured records are rejected when source support is missing", async () => {
  setLlmProviderForTests({
    async extract() {
      return {
        ...validPatientFacingOutput(),
        medications: [{
          name: "Metformin",
          dosage: "500 mg",
          source_text: "Metformin 500 mg",
        }],
      };
    },
  });

  await assert.rejects(
    extractStructuredInformation("The document mentions a routine follow-up visit."),
    /Invalid structured extraction output/
  );
});

test("structured records preserve missing optional values instead of fabricating them", async () => {
  setLlmProviderForTests({
    async extract() {
      return {
        ...validPatientFacingOutput(),
        medications: [{ name: "Metformin", source_text: "Metformin" }],
        follow_up: [{
          type_or_reason: "routine review",
          source_text: "routine review",
        }],
      };
    },
  });

  const output = await extractStructuredInformation(
    "Metformin. routine review."
  );

  assert.deepEqual(output.medications, [{ name: "Metformin", source_text: "Metformin" }]);
  assert.deepEqual(output.follow_up, [{
    type_or_reason: "routine review",
    source_text: "routine review",
  }]);
});

test("LLM extraction preserves ambiguous source text in uncertainty notes", async () => {
  setLlmProviderForTests({
    async extract() {
      return {
        ...validPatientFacingOutput(),
        follow_up: ["The follow-up timing is not specified."],
        patient_summary: "The follow-up timing is not specified.",
        uncertainty_notes: ["The follow-up timing is not specified."],
      };
    },
  });

  const output = await extractStructuredInformation("The follow-up timing is not specified.");

  assert.deepEqual(output.uncertainty_notes, ["The follow-up timing is not specified."]);
});

test("LLM extraction rejects unsupported provider facts", async () => {
  setLlmProviderForTests({
    async extract() {
      return {
        ...validPatientFacingOutput(),
        medications: ["Imaginary medicine 10 mg"],
        patient_summary: "The document lists an imaginary medicine.",
      };
    },
  });

  await assert.rejects(
    extractStructuredInformation("The document mentions a routine follow-up visit."),
    /Invalid structured extraction output/
  );
});

test("owner-only structured extraction endpoint rejects cross-user access", async () => {
  setQueryMock(async (query, values) => {
    assert.match(query, /SELECT id, user_id, extracted_text, processing_status/);
    assert.equal(values[1], "user-a");

    return {
      rows: [],
    };
  });

  const res = createResponse();
  await extractStructuredDocument({ params: { id: "document-a" }, user: { id: "user-a" } } as any, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});

test("unauthenticated structured extraction request is rejected", async () => {
  const res = createResponse();
  await extractStructuredDocument({ params: { id: "document-a" }, user: undefined } as any, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("malformed adapter output is safely rejected by the schema validator", () => {
  const result = validateStructuredExtractionOutput({
    medications: "Ibuprofen",
    findings: [],
    tests: [],
    follow_up: [],
    warnings: [],
    patient_summary: "No document-derived medical information is available.",
    uncertainty_notes: [],
  } as any);

  assert.equal(result.ok, false);
});

test("structured extraction response never leaks extracted medical content or storage metadata", async () => {
  setLlmProviderForTests({
    async extract() {
      return emptyStructuredExtractionOutput();
    },
  });

  setQueryMock(async (query, values) => {
    assert.equal(values[0], "document-a");
    assert.equal(values[1], "user-a");

    return {
      rows: [{
        id: "document-a",
        user_id: "user-a",
        extracted_text: "Sensitive raw OCR text should never be returned",
        processing_status: "completed",
      }],
    };
  });

  const res = createResponse();
  await extractStructuredDocument({ params: { id: "document-a" }, user: { id: "user-a" } } as any, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.document_id, "document-a");
  assert.deepEqual(res.body.extraction, {
    medications: [],
    findings: [],
    tests: [],
    follow_up: [],
    warnings: [],
    patient_summary: "No document-derived medical information is available.",
    uncertainty_notes: [],
  });
  assert.equal(res.body.disclaimer, MEDICAL_DISCLAIMER);
  assert.equal(res.body.extraction.extracted_text, undefined);
  assert.equal(res.body.extraction.storage_key, undefined);
  assert.doesNotMatch(JSON.stringify(res.body), /Sensitive raw OCR text|private-storage-key\.pdf|test-key/);
});

test("structured extraction provider failure returns a safe API error", async () => {
  setLlmProviderForTests({
    async extract() {
      throw new Error("provider failure");
    },
  });

  setQueryMock(async () => ({
    rows: [{
      id: "document-a",
      user_id: "user-a",
      extracted_text: "Sensitive raw OCR text",
      processing_status: "completed",
      storage_key: "private-storage-key.pdf",
    }],
  }));

  const res = createResponse();
  await extractStructuredDocument({ params: { id: "document-a" }, user: { id: "user-a" } } as any, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, {
    success: false,
    message: "Structured extraction provider unavailable",
  });
  assert.doesNotMatch(JSON.stringify(res.body), /Sensitive raw OCR text|private-storage-key\.pdf/);
});

test("structured medication and follow-up records persist in an owner-scoped draft care plan", async () => {
  let queryText = "";
  let queryValues: unknown[] = [];
  setQueryMock(async (query, values) => {
    queryText = query;
    queryValues = values;
    return {
      rows: [{
        id: "draft-a",
        document_id: ownedDocumentId,
        user_id: "user-a",
        status: "draft",
        medication_records: [{
          name: "Metformin",
          dosage: "500 mg",
          frequency: "twice daily",
          source_text: "Metformin 500 mg twice daily",
        }],
        follow_up_records: [{
          type_or_reason: "routine review",
          recommended_date_or_timeframe: "two weeks",
          instructions: "Return in two weeks",
          source_text: "Return in two weeks",
        }],
        updated_at: new Date(),
      }],
    };
  });

  const draft = await persistDraftCarePlan(ownedDocumentId, "user-a", {
    medications: [{
      name: "Metformin",
      dosage: "500 mg",
      frequency: "twice daily",
      source_text: "Metformin 500 mg twice daily",
    }],
    findings: [],
    tests: [],
    follow_up: [{
      type_or_reason: "routine review",
      recommended_date_or_timeframe: "two weeks",
      instructions: "Return in two weeks",
      source_text: "Return in two weeks",
    }],
    warnings: [],
    patient_summary: "The document lists metformin and a routine review.",
    uncertainty_notes: [],
  });

  assert.equal(draft?.status, "draft");
  assert.match(queryText, /INSERT INTO draft_care_plans/);
  assert.match(queryText, /processing_status = 'completed'/);
  assert.match(queryText, /ON CONFLICT \(document_id\) DO UPDATE/);
  assert.deepEqual(queryValues.slice(0, 2), [ownedDocumentId, "user-a"]);
  assert.match(String(queryValues[2]), /Metformin/);
  assert.match(String(queryValues[3]), /routine review/);
});

test("empty extraction creates no fabricated medication or follow-up records", async () => {
  let medicationRecords = "";
  let followUpRecords = "";
  setQueryMock(async (_query, values) => {
    medicationRecords = String(values[2]);
    followUpRecords = String(values[3]);
    return { rows: [{ id: "draft-empty", status: "draft" }] };
  });

  await persistDraftCarePlan(
    ownedDocumentId,
    "user-a",
    emptyStructuredExtractionOutput()
  );

  assert.equal(medicationRecords, "[]");
  assert.equal(followUpRecords, "[]");
});

test("users cannot list another user's documents", async () => {
  setQueryMock(async (_query, values) => {
    const userId = values[0];
    return {
      rows: userId === "user-a"
        ? [{ id: "document-a" }]
        : [{ id: "document-b" }],
    };
  });

  const userAResponse = createResponse();
  const userBResponse = createResponse();
  await listDocuments({ user: { id: "user-a" } } as any, userAResponse);
  await listDocuments({ user: { id: "user-b" } } as any, userBResponse);

  assert.deepEqual(userAResponse.body.documents, [{ id: "document-a" }]);
  assert.deepEqual(userBResponse.body.documents, [{ id: "document-b" }]);
});
