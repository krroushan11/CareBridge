import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../config/database";
import {
  MEDICAL_DISCLAIMER,
  validateReviewedExtraction,
  validateStructuredExtractionOutput,
} from "../services/aiExtractionService";

const idSchema = z.string().uuid();
const reviewStatusSchema = z.object({
  status: z.enum(["approved", "rejected", "changes_requested"]),
  clinician_note: z.string().trim().max(1000).optional(),
}).strict();

const userId = (req: Request) => (req as any).user?.id as string | undefined;
const param = (req: Request, name: string) =>
  typeof req.params[name] === "string" ? req.params[name] : undefined;
const validId = (value: string | undefined): value is string =>
  Boolean(value && idSchema.safeParse(value).success);

const unauthorized = (res: Response) => res.status(401).json({
  success: false,
  message: "Authentication required",
});

const ownerDocument = async (documentId: string, ownerId: string) => {
  const result = await pool.query(
    `SELECT d.id, d.user_id, d.original_filename, d.processing_status, d.extracted_text,
            d.created_at, draft.extraction AS draft_extraction,
            verified.id AS verified_id, verified.verified_extraction,
            verified.disclaimer, verified.confirmed_at, verified.updated_at
     FROM medical_documents d
     LEFT JOIN draft_care_plans draft ON draft.document_id = d.id
     LEFT JOIN verified_care_plans verified ON verified.document_id = d.id
     WHERE d.id = $1 AND d.user_id = $2`,
    [documentId, ownerId]
  );
  return result.rows[0] || null;
};

const recordAudit = async (
  ownerId: string,
  documentId: string,
  action: string,
  carePlanId?: string,
  metadata: Record<string, unknown> = {}
) => {
  await pool.query(
    `INSERT INTO verification_audit_events
       (user_id, document_id, verified_care_plan_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [ownerId, documentId, carePlanId || null, action, JSON.stringify(metadata)]
  );
};

export const getVerificationReview = async (req: Request, res: Response) => {
  const ownerId = userId(req);
  const documentId = param(req, "id");
  if (!ownerId) return unauthorized(res);
  if (!validId(documentId)) return res.status(404).json({ success: false, message: "Medical document not found" });

  try {
    const row = await ownerDocument(documentId, ownerId);
    if (!row) return res.status(404).json({ success: false, message: "Medical document not found" });
    if (row.processing_status !== "completed") {
      return res.status(409).json({ success: false, message: "Medical document is not ready for review" });
    }

    const extraction = row.verified_extraction || row.draft_extraction || null;
    if (extraction) await recordAudit(ownerId, documentId, "reviewed", row.verified_id);

    return res.json({
      success: true,
      document: {
        id: row.id,
        original_filename: row.original_filename,
        processing_status: row.processing_status,
        created_at: row.created_at,
      },
      extraction,
      verified: Boolean(row.verified_id),
      care_plan_id: row.verified_id || null,
      disclaimer: row.disclaimer || MEDICAL_DISCLAIMER,
      confirmed_at: row.confirmed_at || null,
      updated_at: row.updated_at || null,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch verification review" });
  }
};

export const saveVerificationEdits = async (req: Request, res: Response) => {
  const ownerId = userId(req);
  const documentId = param(req, "id");
  if (!ownerId) return unauthorized(res);
  if (!validId(documentId)) return res.status(404).json({ success: false, message: "Medical document not found" });

  try {
    const row = await ownerDocument(documentId, ownerId);
    if (!row) return res.status(404).json({ success: false, message: "Medical document not found" });
    const validation = validateReviewedExtraction(req.body?.extraction, row.extracted_text);
    if (!validation.ok) return res.status(400).json({ success: false, message: validation.error });

    const extraction = validation.data;
    const saved = await pool.query(
      `UPDATE draft_care_plans
       SET extraction = $3::jsonb,
           medication_records = $4::jsonb,
           follow_up_records = $5::jsonb,
           updated_at = NOW()
       WHERE document_id = $1 AND user_id = $2
       RETURNING updated_at`,
      [
        documentId,
        ownerId,
        JSON.stringify(extraction),
        JSON.stringify(extraction.medications),
        JSON.stringify(extraction.follow_up),
      ]
    );
    if (saved.rows.length === 0) {
      return res.status(409).json({ success: false, message: "A draft extraction is not available for this document" });
    }
    await recordAudit(ownerId, documentId, "edited", row.verified_id, {
      categories: ["medications", "findings", "tests", "follow_up", "warnings"],
    });
    return res.json({ success: true, extraction, updated_at: saved.rows[0].updated_at });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to save reviewed edits" });
  }
};

export const confirmDocumentAnalysis = async (req: Request, res: Response) => {
  const ownerId = userId(req);
  const documentId = param(req, "id");
  if (!ownerId) return unauthorized(res);

  const validation = validateStructuredExtractionOutput(req.body?.extraction);
  if (!validation.ok) return res.status(400).json({ success: false, message: "Invalid reviewed extraction data" });

  try {
    const documentResult = await pool.query(
      `SELECT extracted_text FROM medical_documents WHERE id = $1 AND user_id = $2`,
      [documentId, ownerId]
    );
    if (documentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }
    if (documentResult.rows[0].extracted_text) {
      const sourceValidation = validateReviewedExtraction(
        validation.data,
        documentResult.rows[0].extracted_text
      );
      if (!sourceValidation.ok) {
        return res.status(400).json({ success: false, message: sourceValidation.error });
      }
    }

    const confirmedPlan = await pool.query(
      `INSERT INTO verified_care_plans (
         document_id, user_id, verified_extraction, disclaimer, confirmed_at, updated_at
       )
       SELECT $1, $2, $3::jsonb, $4, NOW(), NOW()
       FROM medical_documents
       WHERE id = $1 AND user_id = $2
       ON CONFLICT (document_id) DO UPDATE
       SET verified_extraction = EXCLUDED.verified_extraction,
           disclaimer = EXCLUDED.disclaimer,
           confirmed_at = NOW(),
           updated_at = NOW()
       WHERE verified_care_plans.user_id = EXCLUDED.user_id
       RETURNING id, document_id, user_id, verified_extraction, disclaimer, confirmed_at, updated_at`,
      [documentId, ownerId, JSON.stringify(validation.data), MEDICAL_DISCLAIMER]
    );

    if (confirmedPlan.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Medical document not found" });
    }

    const carePlan = confirmedPlan.rows[0];
    let versionNumber: number | null = null;
    if (carePlan.id) {
      await pool.query(
        `UPDATE verified_care_plan_versions
         SET is_current = FALSE
         WHERE verified_care_plan_id = $1 AND is_current = TRUE`,
        [carePlan.id]
      );
      const versionResult = await pool.query(
        `INSERT INTO verified_care_plan_versions
           (verified_care_plan_id, document_id, user_id, version_number,
            verified_extraction, disclaimer, confirmed_at, is_current)
         SELECT $1, $2, $3,
                COALESCE(MAX(version_number), 0) + 1,
                $4::jsonb, $5, NOW(), TRUE
         FROM verified_care_plan_versions
         WHERE verified_care_plan_id = $1
         RETURNING version_number, confirmed_at`,
        [
          carePlan.id,
          carePlan.document_id,
          ownerId,
          JSON.stringify(validation.data),
          MEDICAL_DISCLAIMER,
        ]
      );
      versionNumber = versionResult.rows[0]?.version_number || null;
      await recordAudit(
        ownerId,
        documentId || "",
        carePlan.updated_at === carePlan.confirmed_at ? "confirmed" : "reconfirmed",
        carePlan.id,
        { version_number: versionNumber }
      );
    }

    return res.status(200).json({
      success: true,
      message: "Reviewed care plan confirmed successfully",
      document_id: carePlan.document_id,
      care_plan_id: carePlan.id,
      care_plan: carePlan.verified_extraction,
      disclaimer: carePlan.disclaimer,
      confirmed_at: carePlan.confirmed_at,
      version_number: versionNumber,
    });
  } catch {
    console.error("Care Plan Confirmation Error");
    return res.status(500).json({ success: false, message: "Failed to confirm reviewed care plan" });
  }
};

export const getVerificationVersions = async (req: Request, res: Response) => {
  const ownerId = userId(req);
  const documentId = param(req, "id");
  if (!ownerId) return unauthorized(res);
  if (!validId(documentId)) return res.status(404).json({ success: false, message: "Medical document not found" });
  try {
    const result = await pool.query(
      `SELECT v.id, v.version_number, v.verified_extraction, v.disclaimer,
              v.confirmed_at, v.created_at, v.is_current
       FROM verified_care_plan_versions v
       JOIN medical_documents d ON d.id = v.document_id AND d.user_id = $2
       WHERE v.document_id = $1 AND v.user_id = $2
       ORDER BY v.version_number DESC`,
      [documentId, ownerId]
    );
    return res.json({ success: true, versions: result.rows });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch version history" });
  }
};

export const getVerificationAuditHistory = async (req: Request, res: Response) => {
  const ownerId = userId(req);
  const documentId = param(req, "id");
  if (!ownerId) return unauthorized(res);
  if (!validId(documentId)) return res.status(404).json({ success: false, message: "Medical document not found" });
  try {
    const result = await pool.query(
      `SELECT id, action, metadata, created_at
       FROM verification_audit_events
       WHERE document_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [documentId, ownerId]
    );
    return res.json({ success: true, events: result.rows });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch review history" });
  }
};

export const submitClinicianReview = async (req: Request, res: Response) => {
  const ownerId = userId(req);
  const documentId = param(req, "id");
  const clinicianId = req.body?.clinician_id;
  if (!ownerId) return unauthorized(res);
  if (!validId(documentId) || !validId(clinicianId)) {
    return res.status(400).json({ success: false, message: "Valid document and clinician IDs are required" });
  }
  try {
    const clinician = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'doctor'`,
      [clinicianId]
    );
    if (clinician.rows.length === 0) return res.status(403).json({ success: false, message: "Clinician authorization required" });
    const result = await pool.query(
      `INSERT INTO clinician_reviews
         (document_id, verified_care_plan_id, patient_user_id, clinician_user_id, patient_note)
       SELECT d.id, v.id, d.user_id, $2, $3
       FROM medical_documents d
       JOIN verified_care_plans v ON v.document_id = d.id AND v.user_id = d.user_id
       WHERE d.id = $1 AND d.user_id = $4
       ON CONFLICT (document_id, clinician_user_id) DO UPDATE
       SET status = 'requested', patient_note = EXCLUDED.patient_note,
           requested_at = NOW(), reviewed_at = NULL, clinician_note = NULL
       RETURNING id, status, requested_at`,
      [documentId, clinicianId, req.body?.patient_note || null, ownerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Verified care plan not found" });
    await recordAudit(ownerId, documentId, "review_submitted", undefined, { clinician_id: clinicianId });
    return res.status(201).json({ success: true, review: result.rows[0] });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to submit clinician review" });
  }
};

export const listClinicianReviews = async (req: Request, res: Response) => {
  const clinicianId = userId(req);
  if (!clinicianId) return unauthorized(res);
  try {
    const result = await pool.query(
      `SELECT r.id, r.document_id, r.status, r.patient_note, r.requested_at,
              r.reviewed_at, d.original_filename, v.verified_extraction, v.disclaimer
       FROM clinician_reviews r
       JOIN medical_documents d ON d.id = r.document_id
       JOIN verified_care_plans v ON v.id = r.verified_care_plan_id
       WHERE r.clinician_user_id = $1
       ORDER BY r.requested_at DESC`,
      [clinicianId]
    );
    return res.json({ success: true, reviews: result.rows });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch clinician reviews" });
  }
};

export const updateClinicianReview = async (req: Request, res: Response) => {
  const clinicianId = userId(req);
  const reviewId = param(req, "reviewId");
  if (!clinicianId) return unauthorized(res);
  if (!validId(reviewId)) return res.status(400).json({ success: false, message: "Invalid review ID" });
  const parsed = reviewStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid clinician review" });
  try {
    const result = await pool.query(
      `UPDATE clinician_reviews
       SET status = $2, clinician_note = $3, reviewed_at = NOW()
       WHERE id = $1 AND clinician_user_id = $4
       RETURNING id, document_id, patient_user_id, verified_care_plan_id, status, reviewed_at`,
      [reviewId, parsed.data.status, parsed.data.clinician_note || null, clinicianId]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Clinician review not found" });
    const review = result.rows[0];
    const action = parsed.data.status === "approved"
      ? "clinician_approved"
      : parsed.data.status === "rejected" ? "clinician_rejected" : "clinician_changes_requested";
    await recordAudit(review.patient_user_id, review.document_id, action, review.verified_care_plan_id, {
      reviewer_id: clinicianId,
    });
    return res.json({ success: true, review });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update clinician review" });
  }
};
