# CareBridge AI — AI Feature Specification

## 1. Purpose
The AI layer converts information extracted from user-provided medical documents into structured, understandable information. It is an assistance component, not a medical professional.

## 2. Pipeline
`Uploaded Document → Text Extraction/OCR → Text Normalization → AI Extraction → Schema Validation → Safety/Consistency Checks → Structured Result → Patient-Friendly Presentation`

## 3. Input
AI receives normalized text from the document-processing pipeline. It must not bypass authentication, file validation, or ownership controls.

## 4. Initial Output Shape
```json
{
  "medications": [],
  "findings": [],
  "tests": [],
  "follow_up": [],
  "warnings": []
}
```

The exact nested fields must be finalized before implementation.

## 5. Extraction Categories
- **Medications:** name, dosage, frequency, duration when available.
- **Findings:** relevant findings/observations stated in the document.
- **Tests:** tests or investigations mentioned.
- **Follow-up:** follow-up instructions or dates stated.
- **Warnings:** important cautions present in the source, with any additional safety guidance clearly labelled.

## 6. Validation
Validate JSON/schema, data types, required structure, unexpected fields, lengths, and malformed objects before treating the response as structured data. Invalid output must fail safely without logging sensitive document content.

## 7. Hallucination Control
The AI must:
- use only information supported by supplied document text;
- return empty values when information is absent;
- never invent medicines, dosages, diagnoses, test results, or dates;
- preserve uncertainty;
- never present guesses as facts.

## 8. Patient-Friendly Explanation
Use plain language, preserve qualifiers, avoid overstating certainty, and distinguish document-derived information from general explanation.

## 9. Security & Privacy
Never expose or log passwords, OTPs, reset tokens, JWTs, credentials, raw medical-document contents, or sensitive AI prompts/results through ordinary application logs.

## 10. Testing
Test valid documents, missing categories, malformed/incomplete AI output, ambiguous information, unsupported information, extraction failures, unauthorized access, cross-user access, and sensitive-data logging behaviour.

## 11. Implementation Order
1. Finalize extraction schema.
2. Finish document-to-text pipeline.
3. Implement AI adapter/service.
4. Implement strict response validation.
5. Add extraction tests.
6. Add safety/edge-case tests.
7. Integrate with document workflow.
8. Build patient-facing UI.

## 12. Definition of Done
The AI milestone is complete only when the AI role and schema are documented, invalid output is safely rejected, sensitive data is protected, edge cases are tested, checks pass, and the complete flow works on controlled test documents.
