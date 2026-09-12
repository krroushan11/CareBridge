import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import {
    extractStructuredDocument,
    listDocuments,
    uploadDocument,
} from "../src/controllers/documentController";
import { authenticateToken } from "../src/middlewares/authMiddleware";
import { MAX_DOCUMENT_SIZE_BYTES } from "../src/middlewares/documentUploadMiddleware";
import {
    emptyStructuredExtractionOutput,
    extractStructuredInformation,
    MEDICAL_DISCLAIMER,
    resetLlmProvider,
    setLlmProviderForTests,
    validateStructuredExtractionOutput,
} from "../src/services/aiExtractionService";
import { createConfiguredLlmProvider } from "../src/services/llmProvider";
import { processMedicalDocument } from "../src/services/documentExtractionService";

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
            medications: { type: "array", items: { type: "string" } },
            findings: { type: "array", items: { type: "string" } },
            tests: { type: "array", items: { type: "string" } },
            follow_up: { type: "array", items: { type: "string" } },
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
