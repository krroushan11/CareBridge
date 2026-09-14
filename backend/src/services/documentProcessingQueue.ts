import { pool } from "../config/database";
import { processMedicalDocument, ProcessingDocument } from "./documentExtractionService";

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 5;

let workerRunning = false;

export const processQueuedDocuments = async (limit = BATCH_SIZE) => {
  await pool.query(
    `UPDATE medical_documents
     SET processing_status = CASE
           WHEN processing_attempts >= 3 THEN 'failed'
           ELSE 'uploaded'
         END,
         processing_completed_at = CASE
           WHEN processing_attempts >= 3 THEN NOW()
           ELSE processing_completed_at
         END,
         processing_error = CASE
           WHEN processing_attempts >= 3 THEN 'processing_failed'
           ELSE 'processing_retry_scheduled'
         END,
         next_retry_at = CASE
           WHEN processing_attempts >= 3 THEN NULL
           ELSE NOW()
         END
     WHERE processing_status = 'processing'
       AND processing_started_at < NOW() - INTERVAL '15 minutes'`
  );

  const queuedDocuments = await pool.query(
    `SELECT id, user_id, storage_key, mime_type
     FROM medical_documents
     WHERE processing_status = 'uploaded'
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  for (const document of queuedDocuments.rows) {
    await processMedicalDocument({
      id: document.id,
      userId: document.user_id,
      storageKey: document.storage_key,
      mimeType: document.mime_type,
    } satisfies ProcessingDocument);
  }
};

const runWorker = async () => {
  if (workerRunning) return;

  workerRunning = true;
  try {
    await processQueuedDocuments();
  } catch {
    // Queue failures are retried by the next poll without logging document data.
  } finally {
    workerRunning = false;
  }
};

export const enqueueDocumentProcessing = () => {
  void runWorker();
};

export const startDocumentProcessingWorker = () => {
  enqueueDocumentProcessing();
  const worker = setInterval(enqueueDocumentProcessing, POLL_INTERVAL_MS);
  worker.unref();
  return worker;
};
