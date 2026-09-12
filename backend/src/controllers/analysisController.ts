import { Request, Response } from "express";
import { pool } from "../config/database";
import {
  MEDICAL_DISCLAIMER,
  validateStructuredExtractionOutput,
} from "../services/aiExtractionService";

export const confirmDocumentAnalysis = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const documentId = req.params.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const validation = validateStructuredExtractionOutput(req.body?.extraction);

  if (!validation.ok) {
    return res.status(400).json({
      success: false,
      message: "Invalid reviewed extraction data",
    });
  }

  try {
    const confirmedPlan = await pool.query(
      `INSERT INTO verified_care_plans (
         document_id,
         user_id,
         verified_extraction,
         disclaimer,
         confirmed_at,
         updated_at
       )
       SELECT $1, $2, $3::jsonb, $4, NOW(), NOW()
       WHERE EXISTS (
         SELECT 1
         FROM medical_documents
         WHERE id = $1
           AND user_id = $2
       )
       ON CONFLICT (document_id) DO UPDATE
       SET verified_extraction = EXCLUDED.verified_extraction,
           disclaimer = EXCLUDED.disclaimer,
           confirmed_at = NOW(),
           updated_at = NOW()
       WHERE verified_care_plans.user_id = EXCLUDED.user_id
       RETURNING document_id, verified_extraction, disclaimer, confirmed_at`,
      [
        documentId,
        userId,
        JSON.stringify(validation.data),
        MEDICAL_DISCLAIMER,
      ]
    );

    if (confirmedPlan.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Medical document not found",
      });
    }

    const carePlan = confirmedPlan.rows[0];

    return res.status(200).json({
      success: true,
      message: "Reviewed care plan confirmed successfully",
      document_id: carePlan.document_id,
      care_plan: carePlan.verified_extraction,
      disclaimer: carePlan.disclaimer,
      confirmed_at: carePlan.confirmed_at,
    });
  } catch {
    console.error("Care Plan Confirmation Error");

    return res.status(500).json({
      success: false,
      message: "Failed to confirm reviewed care plan",
    });
  }
};
