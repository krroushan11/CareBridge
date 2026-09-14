export type LlmProvider = {
  extract: (normalizedText: string) => Promise<unknown>;
};

export class LlmInvalidResponseError extends Error {}

const extractionInstruction = [
  "Extract only facts explicitly supported by the supplied medical document text.",
  "Return only one JSON object with exactly these keys: medications, findings, tests, follow_up, warnings, patient_summary, uncertainty_notes.",
  "Medications may contain structured records with explicitly stated dosage, frequency, route, duration, instructions, and source_text. Follow_up may contain structured records with explicitly stated recommended_date_or_timeframe, status, instructions, provider_or_specialist, and source_text. Tests may contain structured records with explicitly stated name, result_or_value, status, and source_text. Use null for unavailable fields and empty arrays for absent categories.",
  "patient_summary must be a concise plain-language summary of only the returned document-derived facts.",
  "When every fact category is empty, set patient_summary exactly to: No document-derived medical information is available.",
  "Use uncertainty_notes for ambiguity, missing context, or qualifiers in the source. Do not guess.",
  "Do not invent medicines, dosages, diagnoses, test results, dates, or instructions.",
  "Preserve uncertainty and qualifiers from the document.",
].join(" ");

const extractionResponseSchema = {
  type: "object",
  properties: {
    medications: { type: "array", items: { type: ["string", "object"] } },
    findings: { type: "array", items: { type: "string" } },
    tests: { type: "array", items: { type: ["string", "object"] } },
    follow_up: { type: "array", items: { type: ["string", "object"] } },
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
} as const;

class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  async extract(normalizedText: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "medical_document_extraction",
            strict: true,
            schema: extractionResponseSchema,
          },
        },
        messages: [
          { role: "system", content: extractionInstruction },
          { role: "user", content: normalizedText },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error("LLM provider request failed");
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      throw new LlmInvalidResponseError("LLM provider returned no structured content");
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new LlmInvalidResponseError("LLM provider returned malformed JSON");
    }
  }
}

export const createConfiguredLlmProvider = (): LlmProvider => {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return {
      async extract() {
        throw new Error("AI_API_KEY is not configured");
      },
    };
  }

  return new OpenAiCompatibleProvider(apiKey, baseUrl, model);
};
