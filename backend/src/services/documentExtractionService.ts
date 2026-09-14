import { readFile } from "fs/promises";
import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";
import { pool } from "../config/database";
import { getPrivateDocumentPath } from "../middlewares/documentUploadMiddleware";

const MINIMUM_PDF_TEXT_LENGTH = 20;
const MAX_PDF_OCR_PAGES = 20;
export const MAX_PROCESSING_ATTEMPTS = 3;

export type ExtractionResult = {
  text: string;
  method: "pdf_text" | "ocr";
};

export type ExtractionDependencies = {
  extractPdfText: (filePath: string) => Promise<string>;
  renderPdfPages: (filePath: string) => Promise<Buffer[]>;
  extractImageText: (image: Buffer | string) => Promise<string>;
};

export type ProcessingDocument = {
  id: string;
  userId: string;
  storageKey: string;
  mimeType: string;
};

const normalizeExtractedText = (text: string) => text.replace(/\s+/g, " ").trim();

const isRetryableProcessingError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /temporary|timeout|timed out|econn|eio|ebusy|emfile|enfile/.test(message);
};

const retryDelayMs = (attempt: number) => 60_000 * 2 ** Math.max(0, attempt - 1);

export const extractPdfText = async (filePath: string) => {
  const parser = new PDFParse({ data: await readFile(filePath) });

  try {
    const result = await parser.getText();
    return normalizeExtractedText(result.text);
  } finally {
    await parser.destroy();
  }
};

const renderPdfPages = async (filePath: string) => {
  const parser = new PDFParse({ data: await readFile(filePath) });

  try {
    const info = await parser.getInfo();

    if (info.total > MAX_PDF_OCR_PAGES) {
      throw new Error("PDF has too many pages for OCR processing");
    }

    const screenshots = await parser.getScreenshot({
      scale: 2,
      imageBuffer: true,
      imageDataUrl: false,
    });

    return screenshots.pages.map((page) => Buffer.from(page.data));
  } finally {
    await parser.destroy();
  }
};

const extractImageText = async (image: Buffer | string) => {
  Tesseract.setLogging(false);
  const result = await Tesseract.recognize(image, "eng");
  return normalizeExtractedText(result.data.text);
};

const defaultDependencies: ExtractionDependencies = {
  extractPdfText,
  renderPdfPages,
  extractImageText,
};

export const extractMedicalDocumentText = async (
  filePath: string,
  mimeType: string,
  dependencies: ExtractionDependencies = defaultDependencies
): Promise<ExtractionResult> => {
  if (mimeType === "application/pdf") {
    const text = await dependencies.extractPdfText(filePath);

    if (text.length >= MINIMUM_PDF_TEXT_LENGTH) {
      return { text, method: "pdf_text" };
    }

    const pages = await dependencies.renderPdfPages(filePath);
    const extractedPages = await Promise.all(
      pages.map((page) => dependencies.extractImageText(page))
    );
    const extractedText = normalizeExtractedText(extractedPages.join("\n"));

    if (!extractedText) {
      throw new Error("OCR did not extract readable text");
    }

    return { text: extractedText, method: "ocr" };
  }

  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    const text = await dependencies.extractImageText(filePath);

    if (!text) {
      throw new Error("OCR did not extract readable text");
    }

    return { text, method: "ocr" };
  }

  throw new Error("Unsupported document type");
};

// Phase 1 foundation: deterministic status lifecycle, safe status metadata,
// PDF-first text extraction with OCR fallback, and normalized stored text.
export const processMedicalDocument = async (
  document: ProcessingDocument,
  extractor = extractMedicalDocumentText
) => {
  let attempt = 0;

  try {
    const processingResult = await pool.query(
      `UPDATE medical_documents
       SET processing_status = 'processing',
           processing_started_at = NOW(),
           processing_completed_at = NULL,
           processing_method = NULL,
           processing_error = NULL,
           extracted_text = NULL,
           next_retry_at = NULL,
           processing_attempts = processing_attempts + 1
       WHERE id = $1
         AND user_id = $2
         AND processing_status = 'uploaded'
       RETURNING id, processing_attempts`,
      [document.id, document.userId]
    );

    if (processingResult.rows.length === 0) {
      return;
    }

    attempt = Number(processingResult.rows[0].processing_attempts);

    const extraction = await extractor(
      getPrivateDocumentPath(document.storageKey),
      document.mimeType
    );

    if (!extraction.text) {
      throw new Error("No text extracted from medical document");
    }

    await pool.query(
      `UPDATE medical_documents
       SET extracted_text = $1,
           processing_method = $2,
           processing_status = 'completed',
           processing_completed_at = NOW(),
           processing_error = NULL
       WHERE id = $3
         AND user_id = $4
         AND processing_status = 'processing'`,
      [normalizeExtractedText(extraction.text), extraction.method, document.id, document.userId]
    );
  } catch (error) {
    try {
      const shouldRetry = attempt > 0 &&
        attempt < MAX_PROCESSING_ATTEMPTS &&
        isRetryableProcessingError(error);

      if (shouldRetry) {
        await pool.query(
          `UPDATE medical_documents
           SET processing_status = 'uploaded',
               processing_method = NULL,
               processing_error = 'processing_retry_scheduled',
               next_retry_at = $1
           WHERE id = $2
             AND user_id = $3
             AND processing_status = 'processing'`,
          [new Date(Date.now() + retryDelayMs(attempt)), document.id, document.userId]
        );
        return;
      }

      await pool.query(
        `UPDATE medical_documents
       SET extracted_text = NULL,
           processing_status = 'failed',
           processing_method = NULL,
           processing_completed_at = NOW(),
           processing_error = 'processing_failed',
           next_retry_at = NULL
       WHERE id = $1
         AND user_id = $2
         AND processing_status = 'processing'`,
        [document.id, document.userId]
      );
    } catch {
      // Processing errors must not expose document content or database details.
    }
  }
};
