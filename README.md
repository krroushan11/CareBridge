# CareBridge AI - Phase 7

## Phase 7 - Schema Validation & AI Safety

## Objective

Phase 7 treats AI-generated medical extraction as untrusted input. Every
structured response is validated before acceptance, checked against the source
document, and handled safely without fabricating unsupported medical
information or exposing sensitive data.

## Implementation Status

**[✓] IMPLEMENTED**

All Phase 7 checklist requirements are complete.

## Implemented Features

- Zod strict schema validation.
- Required extraction categories.
- Data type validation.
- Maximum item counts.
- Field length restrictions.
- Unexpected field rejection.
- Source-support validation.
- Empty-source safe behavior.
- AI disclaimer.
- No invented medicines.
- No invented diagnoses.
- No invented test results.
- No invented dates.
- Sensitive data protection in errors.
- Structured medication dosage validation.
- Medication frequency validation.
- Medication duration validation.
- Medication route validation.
- Structured follow-up date, date-time, and timeframe validation.
- Follow-up status validation.
- Structured test information validation.

## AI Safety Rules

Extracted medical information must be supported by the source document. The
system rejects unsupported or malformed AI output rather than treating it as
fact.

The AI must not fabricate medicines, dosages, frequencies, durations, routes,
diagnoses, test names, test results, dates, follow-up instructions, or other
medical information. Missing information remains missing or null, and source
uncertainty is preserved where applicable.

## Validation and Testing

Phase 7 validation and regression coverage includes:

- Valid medication dosage tests.
- Invalid medication dosage tests.
- Valid medication frequency tests.
- Invalid medication frequency tests.
- Valid medication duration tests.
- Invalid medication duration tests.
- Valid medication route tests.
- Invalid medication route tests.
- Valid follow-up date tests.
- Invalid follow-up date tests, including invalid calendar dates.
- Valid follow-up status tests.
- Invalid follow-up status tests.
- Valid structured test information tests.
- Malformed and unsupported test information tests.
- Source-support rejection tests.
- Empty-source safety tests.
- Unexpected-field rejection tests.
- Malformed AI response handling tests.
- Analysis/verification regression tests.
- Authentication/RBAC regression tests.
- Reset authorization regression tests.
- Backend TypeScript build validation.
- `git diff --check`.

## API / Validation Behavior

Structured extraction responses are validated with strict Zod schemas before
they are returned or persisted. Required categories, types, item limits,
field lengths, structured medication fields, follow-up fields, and test fields
must conform to the supported model.

Medication records validate dosage, frequency, duration, and route values.
Follow-up records validate ISO dates, ISO date-times, explicit relative
timeframes, and supported statuses. Test records validate test name,
result/value, status, and source text when present.

Unexpected fields and malformed values are rejected safely. Source-support
checks run after schema validation and reject structured facts that are not
supported by the extracted document text. Empty source input returns the safe
empty extraction structure and does not create fabricated facts.

## Security and Data Protection

- Authentication is required for protected document extraction operations.
- Authorization and document ownership checks remain enforced.
- Structured extraction is available only for completed, owner-scoped
  documents.
- AI output is validated before it can be returned or persisted.
- Source-support validation reduces hallucinated medical content.
- Provider failures and malformed responses return safe errors.
- API keys, credentials, tokens, raw document content, and sensitive provider
  details are not exposed in errors or ordinary responses.
- The existing authentication, RBAC, document ownership, OCR, human
  verification, and verified care-plan behavior remain protected.

## Phase 7 Completion

**Phase 7 - Schema Validation & AI Safety is IMPLEMENTED.**

All Phase 7 schema, safety, validation, and regression checklist requirements
are complete.
