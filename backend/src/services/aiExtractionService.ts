import { z } from "zod";
import {
  createConfiguredLlmProvider,
  LlmInvalidResponseError,
  LlmProvider,
} from "./llmProvider";

export const STRUCTURED_EXTRACTION_CATEGORIES = [
  "medications",
  "findings",
  "tests",
  "follow_up",
  "warnings",
] as const;

export type StructuredExtractionCategory =
  | "medications"
  | "findings"
  | "tests"
  | "follow_up"
  | "warnings";

export type StructuredMedicationRecord = {
  name: string;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  duration?: string | null;
  instructions?: string | null;
  source_text?: string | null;
};

export type StructuredFollowUpRecord = {
  type_or_reason: string;
  recommended_date_or_timeframe?: string | null;
  instructions?: string | null;
  provider_or_specialist?: string | null;
  status?: "recommended" | "scheduled" | "completed" | "cancelled" | null;
  source_text?: string | null;
};

export type StructuredTestRecord = {
  name: string;
  result_or_value?: string | null;
  status?: "normal" | "abnormal" | "positive" | "negative" | "pending" | "not_available" | null;
  source_text?: string | null;
};

export type StructuredExtractionOutput = {
  medications: Array<string | StructuredMedicationRecord>;
  findings: string[];
  tests: Array<string | StructuredTestRecord>;
  follow_up: Array<string | StructuredFollowUpRecord>;
  warnings: string[];
  patient_summary: string;
  uncertainty_notes: string[];
};

export const MEDICAL_DISCLAIMER =
  "This information is extracted from your document for informational purposes only. It is not a diagnosis and does not replace advice from a qualified healthcare professional. Contact your clinician for questions about your care.";
export const EMPTY_PATIENT_SUMMARY =
  "No document-derived medical information is available.";

const MAX_FACT_ITEMS = 10;
const MAX_FACT_LENGTH = 300;
const MAX_UNCERTAINTY_NOTES = 5;
const MAX_SUMMARY_LENGTH = 1000;

const boundedText = z.string().trim().min(1).max(MAX_FACT_LENGTH);
const optionalBoundedText = boundedText.nullable().optional();
const dosageText = z.string().trim().min(1).max(100).regex(
  /^\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|ml|mL|L|units?|iu|tablet(?:s)?|capsule(?:s)?|puff(?:s)?|drop(?:s)?)$/i,
  "Invalid medication dosage"
);
const frequencyText = z.string().trim().min(1).max(100).regex(
  /^(?:once|twice|three times|four times|every)\b.*$/i,
  "Invalid medication frequency"
);
const durationText = z.string().trim().min(1).max(100).regex(
  /^(?:\d+(?:\.\d+)?\s*(?:day|days|week|weeks|month|months|year|years)|as needed|ongoing|until finished)$/i,
  "Invalid medication duration"
);
const routeSchema = z.enum([
  "oral",
  "sublingual",
  "topical",
  "transdermal",
  "inhaled",
  "intravenous",
  "intramuscular",
  "subcutaneous",
  "rectal",
  "vaginal",
  "ophthalmic",
  "otic",
  "nasal",
  "unknown",
]);
const isCalendarDate = (value: string) => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = dateOnly
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);

  return !Number.isNaN(parsed.getTime())
    && (!dateOnly || parsed.toISOString().slice(0, 10) === value);
};
const followUpDateText = z.string().trim().min(1).max(100).refine(
  (value) => (
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)
      && isCalendarDate(value)
  )
    || /^(?:today|tomorrow|next week|next month|in \d+ (?:day|days|week|weeks|month|months)|\d+ (?:day|days|week|weeks|month|months))$/i.test(value),
  "Invalid follow-up date or timeframe"
);

const medicationRecordSchema = z.object({
  name: boundedText,
  dosage: dosageText.nullable().optional(),
  frequency: frequencyText.nullable().optional(),
  route: routeSchema.nullable().optional(),
  duration: durationText.nullable().optional(),
  instructions: optionalBoundedText,
  source_text: optionalBoundedText,
}).strict();

const followUpRecordSchema = z.object({
  type_or_reason: boundedText,
  recommended_date_or_timeframe: followUpDateText.nullable().optional(),
  instructions: optionalBoundedText,
  provider_or_specialist: optionalBoundedText,
  status: z.enum(["recommended", "scheduled", "completed", "cancelled"]).nullable().optional(),
  source_text: optionalBoundedText,
}).strict();

const testRecordSchema = z.object({
  name: boundedText,
  result_or_value: optionalBoundedText,
  status: z.enum(["normal", "abnormal", "positive", "negative", "pending", "not_available"]).nullable().optional(),
  source_text: optionalBoundedText,
}).strict();

export const structuredExtractionSchema = z.object({
  medications: z.array(z.union([boundedText, medicationRecordSchema])).max(MAX_FACT_ITEMS),
  findings: z.array(boundedText).max(MAX_FACT_ITEMS),
  tests: z.array(z.union([boundedText, testRecordSchema])).max(MAX_FACT_ITEMS),
  follow_up: z.array(z.union([boundedText, followUpRecordSchema])).max(MAX_FACT_ITEMS),
  warnings: z.array(boundedText).max(MAX_FACT_ITEMS),
  patient_summary: z.string().trim().min(1).max(MAX_SUMMARY_LENGTH),
  uncertainty_notes: z.array(boundedText).max(MAX_UNCERTAINTY_NOTES),
}).strict();

export const emptyStructuredExtractionOutput = (): StructuredExtractionOutput => ({
  medications: [],
  findings: [],
  tests: [],
  follow_up: [],
  warnings: [],
  patient_summary: EMPTY_PATIENT_SUMMARY,
  uncertainty_notes: [],
});

export const validateStructuredExtractionOutput = (
  output: unknown
): { ok: true; data: StructuredExtractionOutput } | { ok: false; error: string } => {
  const parsed = structuredExtractionSchema.safeParse(output);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid structured extraction output",
    };
  }

  return {
    ok: true,
    data: parsed.data,
  };
};

export class StructuredExtractionError extends Error {
  constructor(
    public readonly code: "provider_failure" | "invalid_output"
  ) {
    super(code === "invalid_output"
      ? "Invalid structured extraction output"
      : "Structured extraction provider unavailable");
  }
}

let configuredProvider: LlmProvider = createConfiguredLlmProvider();

export const setLlmProviderForTests = (provider: LlmProvider) => {
  configuredProvider = provider;
};

export const resetLlmProvider = () => {
  configuredProvider = createConfiguredLlmProvider();
};

const normalizeInput = (text: string) => text.replace(/\s+/g, " ").trim();

const normalizeForComparison = (text: string) =>
  normalizeInput(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const summaryTermsToIgnore = new Set([
  "this", "that", "document", "lists", "list", "mentions", "mentioned",
  "notes", "noted", "shows", "indicates", "information", "medical",
  "and", "with", "from", "for", "the", "are", "was", "were",
]);

const isFactSupportedBySource = (fact: string, sourceText: string) => {
  const normalizedFact = normalizeForComparison(fact);
  const normalizedSource = normalizeForComparison(sourceText);

  if (normalizedSource.includes(normalizedFact)) {
    return true;
  }

  const significantTerms = [...new Set(normalizedFact.split(" ").filter(
    (term) => term.length >= 4 && !summaryTermsToIgnore.has(term)
  ))];

  if (significantTerms.length === 0) {
    return false;
  }

  const matchedTerms = significantTerms.filter((term) => normalizedSource.includes(term));
  return matchedTerms.length / significantTerms.length >= 0.75;
};

const medicationFactText = (medication: string | StructuredMedicationRecord) =>
  typeof medication === "string"
    ? medication
    : medication.source_text || [
        medication.name,
        medication.dosage,
        medication.frequency,
        medication.route,
        medication.duration,
        medication.instructions,
      ].filter(Boolean).join(" ");

const followUpFactText = (followUp: string | StructuredFollowUpRecord) =>
  typeof followUp === "string"
    ? followUp
    : followUp.source_text || [
        followUp.type_or_reason,
        followUp.recommended_date_or_timeframe,
        followUp.instructions,
        followUp.provider_or_specialist,
        followUp.status,
      ].filter(Boolean).join(" ");

const testFactText = (test: string | StructuredTestRecord) =>
  typeof test === "string"
    ? test
    : [
        test.name,
        test.result_or_value,
        test.status,
        test.source_text,
      ].filter(Boolean).join(" ");

const hasSupportedOutput = (output: StructuredExtractionOutput, sourceText: string) => {
  const hasFacts = STRUCTURED_EXTRACTION_CATEGORIES.some((category) => output[category].length > 0);

  if (!hasFacts) {
    return output.patient_summary === EMPTY_PATIENT_SUMMARY;
  }

  return STRUCTURED_EXTRACTION_CATEGORIES.every((category) =>
    output[category].every((fact) => {
      const factText = category === "medications"
        ? medicationFactText(fact as string | StructuredMedicationRecord)
        : category === "follow_up"
          ? followUpFactText(fact as string | StructuredFollowUpRecord)
          : category === "tests"
            ? testFactText(fact as string | StructuredTestRecord)
            : fact as string;

      return isFactSupportedBySource(factText, sourceText);
    })
  );
};

export const extractStructuredInformation = async (
  extractedText: string | null | undefined,
  provider: LlmProvider = configuredProvider
): Promise<StructuredExtractionOutput> => {
  const normalizedText = normalizeInput(extractedText ?? "");

  if (!normalizedText) {
    return emptyStructuredExtractionOutput();
  }

  let providerOutput: unknown;

  try {
    providerOutput = await provider.extract(normalizedText);
  } catch (error) {
    if (error instanceof LlmInvalidResponseError) {
      throw new StructuredExtractionError("invalid_output");
    }

    throw new StructuredExtractionError("provider_failure");
  }

  const validation = validateStructuredExtractionOutput(providerOutput);

  if (!validation.ok) {
    throw new StructuredExtractionError("invalid_output");
  }

  if (!hasSupportedOutput(validation.data, normalizedText)) {
    throw new StructuredExtractionError("invalid_output");
  }

  return validation.data;
};
