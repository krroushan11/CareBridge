import { Request, Response } from "express";
import { access, constants, open, unlink } from "fs/promises";
import { basename } from "path";
import { z } from "zod";
import { pool } from "../config/database";
import {
    isAllowedMedicalDocument,
    getPrivateDocumentPath,
    MAX_DOCUMENT_SIZE_BYTES,
} from "../middlewares/documentUploadMiddleware";
import {
    extractStructuredInformation,
    MEDICAL_DISCLAIMER,
    StructuredExtractionError,
} from "../services/aiExtractionService";
import { enqueueDocumentProcessing } from "../services/documentProcessingQueue";
import { persistDraftCarePlan } from "../services/draftCarePlanService";

const documentIdSchema = z.string().uuid();
const documentMetadataSchema = z.object({
  original_filename: z.string().trim().min(1).max(255).refine(
    (value) => basename(value) === value && !/[\u0000-\u001f\\/]/.test(value),
    "Invalid document filename"
  ),
}).strict();

const isValidDocumentId = (documentId: string) => documentIdSchema.safeParse(documentId).success;

const safeDownloadFilename = (filename: string) =>
  basename(filename).replace(/["\\\r\n]/g, "_") || "medical-document";

const safeProcessingErrors = new Set(["processing_retry_scheduled", "processing_failed"]);

const toSafeProcessingError = (error: unknown) =>
  typeof error === "string" && safeProcessingErrors.has(error) ? error : null;

const removeUploadedFile = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch (error) {
    // The uploaded file may already have been removed.
  }
};

const hasValidDocumentSignature = async (file: Express.Multer.File) => {
  const fileHandle = await open(file.path, "r");
  const bytes = Buffer.alloc(12);

  try {
    const { bytesRead } = await fileHandle.read(bytes, 0, bytes.length, 0);

    if (file.mimetype === "application/pdf") {
      return bytesRead >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    }

    if (file.mimetype === "image/jpeg") {
      return bytesRead >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }

    if (file.mimetype === "image/png") {
      return (
        bytesRead >= 8 &&
        bytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        )
      );
    }

    return false;
  } finally {
    await fileHandle.close();
  }
};

export const uploadDocument = async (req: Request, res: Response) => {
  const file = req.file;
  const userId = (req as any).user?.id;

  if (!file) {
    return res.status(400).json({
      success: false,
      message: "Medical document is required",
    });
  }

  if (!isAllowedMedicalDocument(file.mimetype, file.originalname)) {
    await removeUploadedFile(file.path);
    return res.status(400).json({
      success: false,
      message: "Only PDF, JPEG, and PNG medical documents are allowed",
    });
  }

  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    await removeUploadedFile(file.path);
    return res.status(413).json({
      success: false,
      message: "Medical document must be 10 MB or smaller",
    });
  }

  try {
    if (!userId || !(await hasValidDocumentSignature(file))) {
      await removeUploadedFile(file.path);
      return res.status(400).json({
        success: false,
        message: "Invalid medical document",
      });
    }

    const documentResult = await pool.query(
      `INSERT INTO medical_documents (
         user_id,
         original_filename,
         storage_key,
         mime_type,
         file_size,
         processing_status
       )
       VALUES ($1, $2, $3, $4, $5, 'uploaded')
       RETURNING id, original_filename, mime_type, file_size, processing_status, created_at`,
      [
        userId,
        basename(file.originalname),
        file.filename,
        file.mimetype,
        file.size,
      ]
    );

    const createdDocument = documentResult.rows[0];

    enqueueDocumentProcessing();

    return res.status(201).json({
      success: true,
      message: "Medical document uploaded successfully",
      document: {
        id: createdDocument.id,
        original_filename: createdDocument.original_filename,
        mime_type: createdDocument.mime_type,
        file_size: createdDocument.file_size,
        processing_status: createdDocument.processing_status,
        created_at: createdDocument.created_at,
      },
    });
  } catch {
    await removeUploadedFile(file.path);
    console.error("Document Upload Error");

    return res.status(500).json({
      success: false,
      message: "Failed to upload medical document",
    });
  }
};

export const extractStructuredDocument = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const documentId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const documentResult = await pool.query(
      `SELECT id, user_id, extracted_text, processing_status
       FROM medical_documents
       WHERE id = $1
         AND user_id = $2`,
      [documentId, userId]
    );

    if (documentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Medical document not found",
      });
    }

    const document = documentResult.rows[0];

    if (document.processing_status !== "completed") {
      return res.status(409).json({
        success: false,
        message: "Medical document is not ready for structured extraction",
      });
    }

    const structuredOutput = await extractStructuredInformation(document.extracted_text);
    const draftCarePlan = await persistDraftCarePlan(
      document.id,
      userId,
      structuredOutput
    );

    if (!draftCarePlan) {
      return res.status(409).json({
        success: false,
        message: "Medical document is not ready for draft care-plan persistence",
      });
    }

    return res.status(200).json({
      success: true,
      document_id: document.id,
      extraction: structuredOutput,
      draft_care_plan: {
        id: draftCarePlan.id,
        status: draftCarePlan.status,
        medication_records: draftCarePlan.medication_records,
        follow_up_records: draftCarePlan.follow_up_records,
        updated_at: draftCarePlan.updated_at,
      },
      disclaimer: MEDICAL_DISCLAIMER,
    });
  } catch (error) {
    if (error instanceof StructuredExtractionError) {
      return res.status(error.code === "invalid_output" ? 422 : 502).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to build structured extraction",
    });
  }
};

export const downloadDocument = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const documentId = typeof req.params.id === "string" ? req.params.id : "";

  if (!userId) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  if (!isValidDocumentId(documentId)) {
    return res.status(404).json({ success: false, message: "Medical document not found" });
  }

  try {
    const result = await pool.query(
      `SELECT storage_key, mime_type, original_filename
       FROM medical_documents
       WHERE id = $1 AND user_id = $2`,
      [documentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }

    const document = result.rows[0];
    const privatePath = getPrivateDocumentPath(document.storage_key);

    try {
      await access(privatePath, constants.R_OK);
    } catch {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }

    return res.sendFile(privatePath, {
      headers: {
        "Content-Type": document.mime_type,
        "Content-Disposition": `attachment; filename="${safeDownloadFilename(document.original_filename)}"`,
      },
      dotfiles: "deny",
    }, (error?: Error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ success: false, message: "Medical document not found" });
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to download medical document" });
  }
};

export const updateDocumentMetadata = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const documentId = typeof req.params.id === "string" ? req.params.id : "";
  const parsed = documentMetadataSchema.safeParse(req.body);

  if (!userId) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  if (!isValidDocumentId(documentId)) {
    return res.status(404).json({ success: false, message: "Medical document not found" });
  }

  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid document metadata" });
  }

  try {
    const result = await pool.query(
      `UPDATE medical_documents
       SET original_filename = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, original_filename, mime_type, file_size, processing_status, created_at`,
      [parsed.data.original_filename, documentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }

    return res.status(200).json({ success: true, message: "Medical document updated successfully", document: result.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update medical document" });
  }
};

export const getDocumentProcessingStatus = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const documentId = typeof req.params.id === "string" ? req.params.id : "";

  if (!userId) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  if (!isValidDocumentId(documentId)) {
    return res.status(404).json({ success: false, message: "Medical document not found" });
  }

  try {
    const result = await pool.query(
      `SELECT id, processing_status, processing_method, processing_started_at,
              processing_completed_at, processing_error, processing_attempts, next_retry_at
       FROM medical_documents
       WHERE id = $1 AND user_id = $2`,
      [documentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }

    return res.status(200).json({
      success: true,
      document: {
        ...result.rows[0],
        processing_error: toSafeProcessingError(result.rows[0].processing_error),
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch document processing status" });
  }
};

export const deleteDocument = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const documentId = typeof req.params.id === "string" ? req.params.id : "";

  if (!userId) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  if (!isValidDocumentId(documentId)) {
    return res.status(404).json({ success: false, message: "Medical document not found" });
  }

  try {
    const result = await pool.query(
      `SELECT storage_key FROM medical_documents WHERE id = $1 AND user_id = $2`,
      [documentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }

    try {
      await unlink(getPrivateDocumentPath(result.rows[0].storage_key));
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        return res.status(500).json({ success: false, message: "Failed to delete medical document" });
      }
    }

    const deleted = await pool.query(
      `DELETE FROM medical_documents WHERE id = $1 AND user_id = $2 RETURNING id`,
      [documentId, userId]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }

    return res.status(200).json({ success: true, message: "Medical document deleted successfully" });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to delete medical document" });
  }
};

export const listDocuments = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const documentResult = await pool.query(
      `SELECT id, original_filename, mime_type, file_size, processing_status,
              processing_method, processing_started_at,
              processing_completed_at, processing_error,
              created_at
       FROM medical_documents
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const documents = documentResult.rows.map((row) => {
      const safeRow: Record<string, unknown> = {};

      if (row.id !== undefined) {
        safeRow.id = row.id;
      }

      if (row.original_filename !== undefined) {
        safeRow.original_filename = row.original_filename;
      }

      if (row.mime_type !== undefined) {
        safeRow.mime_type = row.mime_type;
      }

      if (row.file_size !== undefined) {
        safeRow.file_size = row.file_size;
      }

      if (row.processing_status !== undefined) {
        safeRow.processing_status = row.processing_status;
      }

      if (row.processing_method !== undefined) {
        safeRow.processing_method = row.processing_method;
      }

      if (row.processing_started_at !== undefined) {
        safeRow.processing_started_at = row.processing_started_at;
      }

      if (row.processing_completed_at !== undefined) {
        safeRow.processing_completed_at = row.processing_completed_at;
      }

      if (row.processing_error !== undefined) {
        safeRow.processing_error = row.processing_error;
      }

      if (row.created_at !== undefined) {
        safeRow.created_at = row.created_at;
      }

      return safeRow;
    });

    return res.status(200).json({
      success: true,
      documents,
    });
  } catch {
    console.error("Document List Error");

    return res.status(500).json({
      success: false,
      message: "Failed to fetch medical documents",
    });
  }
};
