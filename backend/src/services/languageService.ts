import { LlmProvider } from "./llmProvider";

export const LANGUAGE_CONFIG = [
  { code: "en", displayName: "English", locale: "en-IN", enabled: true },
  { code: "en-simple", displayName: "Simple English", locale: "en-IN", enabled: true },
  { code: "hi", displayName: "Hindi", locale: "hi-IN", enabled: true },
  { code: "bn", displayName: "Bengali", locale: "bn-IN", enabled: true },
  { code: "mr", displayName: "Marathi", locale: "mr-IN", enabled: true },
  { code: "ta", displayName: "Tamil", locale: "ta-IN", enabled: true },
  { code: "te", displayName: "Telugu", locale: "te-IN", enabled: true },
  { code: "kn", displayName: "Kannada", locale: "kn-IN", enabled: true },
  { code: "gu", displayName: "Gujarati", locale: "gu-IN", enabled: true },
  { code: "pa", displayName: "Punjabi", locale: "pa-IN", enabled: true },
  { code: "ml", displayName: "Malayalam", locale: "ml-IN", enabled: true },
] as const;

export type LanguageCode = (typeof LANGUAGE_CONFIG)[number]["code"];

export interface LanguageRequest {
  language?: LanguageCode;
  simplify?: boolean;
}

export interface LanguageMetadata {
  language: LanguageCode;
  mode: "standard" | "simple";
  translated: boolean;
  safety_checked: boolean;
}

const byCode = new Map(LANGUAGE_CONFIG.map((language) => [language.code, language]));

export const resolveLanguageRequest = (request: LanguageRequest = {}) => {
  const language = request.language && byCode.get(request.language)?.enabled ? request.language : "en";
  return { language, simplify: language === "en-simple" || Boolean(request.simplify) } as const;
};

// Literal clinical values are deliberately kept unchanged across language output.
const protectedLiterals = (source: string) => {
  const medicineNames = Array.from(source.matchAll(/\b(?:take|taking|medication|medicine|drug)\s+([A-Za-z][A-Za-z0-9-]*)/gi)).map((match) => match[1]);
  const namedTerms = (source.match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) || [])
    .filter((term) => !new Set(["Take", "Contact", "Please", "Your", "This", "That", "CareBridge"]).has(term));
  return Array.from(new Set([
    ...(source.match(/\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|mL|IU|units?|mmHg|%|mmol\/?L|mg\/?dL)\b/gi) || []),
    ...(source.match(/\b\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}\b/g) || []),
    ...medicineNames,
    ...namedTerms,
  ]));
};

const hasSafetyWarning = (source: string) => /emergency|urgent|call\s+(?:your\s+)?(?:doctor|clinician)|do not|warning|contraindicat/i.test(source);

const preservesSafety = (source: string, candidate: string) => {
  if (!candidate.trim()) return false;
  if (!protectedLiterals(source).every((literal) => candidate.includes(literal))) return false;
  // The model must retain an explicit warning when the verified answer had one.
  return !hasSafetyWarning(source) || /emergency|urgent|doctor|clinician|do not|warning|contraindicat|आपात|डॉक्टर|चिकित्सक|জরুরি|ডাক্তার|तातडी|डॉक्टर|அவசர|மருத்துவர்|అత్యవసర|వైద్యుడు|ತುರ್ತು|ವೈದ್ಯ|તાત્કાલિક|ડૉક્ટર|ਐਮਰਜੈਂਸੀ|ਡਾਕਟਰ|അടിയന്തര|ഡോക്ടർ/i.test(candidate);
};

export const localizeVerifiedResponse = async (
  answer: string,
  request: LanguageRequest,
  provider: LlmProvider
): Promise<{ answer: string; metadata: LanguageMetadata }> => {
  const settings = resolveLanguageRequest(request);
  const metadata: LanguageMetadata = {
    language: settings.language,
    mode: settings.simplify ? "simple" : "standard",
    translated: false,
    safety_checked: true,
  };
  if (settings.language === "en" && !settings.simplify) return { answer, metadata };
  const language = byCode.get(settings.language)!;
  try {
    const candidate = await provider.chat(
      "You are CareBridge's post-grounding language layer. Transform only the supplied verified answer; do not add, omit, diagnose, prescribe, or strengthen instructions. Preserve every medication name, number, dosage, frequency, duration, laboratory value, unit, date, test name, clinician instruction, uncertainty statement, disclaimer, emergency warning, and source reference exactly in meaning. Keep medicine names and numeric values verbatim. Use patient-friendly language. If simple mode is requested, use short, clear sentences and explain necessary medical terms. Return only the transformed answer.",
      `TARGET LANGUAGE: ${language.displayName}\nSIMPLE MODE: ${settings.simplify ? "yes" : "no"}\n\nVERIFIED ANSWER (the only source):\n${answer}`
    );
    if (!preservesSafety(answer, candidate)) return { answer, metadata };
    return { answer: candidate, metadata: { ...metadata, translated: settings.language !== "en" && settings.language !== "en-simple" } };
  } catch {
    // A provider failure never replaces a verified answer with an ungrounded or blank response.
    return { answer, metadata };
  }
};
