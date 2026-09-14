import { pool } from "../config/database";
import {
  StructuredExtractionOutput,
  StructuredFollowUpRecord,
  StructuredMedicationRecord,
} from "./aiExtractionService";

const toMedicationRecord = (
  medication: string | StructuredMedicationRecord
): StructuredMedicationRecord => typeof medication === "string"
  ? { name: medication, source_text: medication }
  : medication;

const toFollowUpRecord = (
  followUp: string | StructuredFollowUpRecord
): StructuredFollowUpRecord => typeof followUp === "string"
  ? { type_or_reason: followUp, source_text: followUp }
  : followUp;

export const persistDraftCarePlan = async (
  documentId: string,
  userId: string,
  extraction: StructuredExtractionOutput
) => {
  const result = await pool.query(
    `INSERT INTO draft_care_plans (
       document_id,
       user_id,
       status,
       medication_records,
       follow_up_records,
       extraction,
       created_at,
       updated_at
     )
     SELECT $1, $2, 'draft', $3::jsonb, $4::jsonb, $5::jsonb, NOW(), NOW()
     FROM medical_documents
     WHERE id = $1
       AND user_id = $2
       AND processing_status = 'completed'
     ON CONFLICT (document_id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         status = 'draft',
         medication_records = EXCLUDED.medication_records,
         follow_up_records = EXCLUDED.follow_up_records,
         extraction = EXCLUDED.extraction,
         updated_at = NOW()
     WHERE draft_care_plans.user_id = EXCLUDED.user_id
     RETURNING id, document_id, user_id, status, medication_records,
               follow_up_records, updated_at`,
    [
      documentId,
      userId,
      JSON.stringify(extraction.medications.map(toMedicationRecord)),
      JSON.stringify(extraction.follow_up.map(toFollowUpRecord)),
      JSON.stringify(extraction),
    ]
  );

  return result.rows[0] || null;
};
