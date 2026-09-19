import assert from "node:assert/strict";
import { test } from "node:test";
import { LANGUAGE_CONFIG, localizeVerifiedResponse, resolveLanguageRequest } from "../src/services/languageService";
import { LlmProvider } from "../src/services/llmProvider";

const provider = (response: string): LlmProvider => ({
  async extract() { return {}; },
  async embed() { return [0]; },
  async chat() { return response; },
});

test("Phase 16 exposes every configured, enabled language", () => {
  assert.deepEqual(LANGUAGE_CONFIG.map((item) => item.code), ["en", "en-simple", "hi", "bn", "mr", "ta", "te", "kn", "gu", "pa", "ml"]);
  assert.equal(resolveLanguageRequest({ language: "not-supported" as any }).language, "en");
  assert.deepEqual(resolveLanguageRequest({}), { language: "en", simplify: false });
});

test("English returns the original verified answer without a second provider call", async () => {
  const result = await localizeVerifiedResponse("Take Aspirin 5 mg daily. Contact your clinician.", {}, provider("should not run"));
  assert.equal(result.answer, "Take Aspirin 5 mg daily. Contact your clinician.");
  assert.deepEqual(result.metadata, { language: "en", mode: "standard", translated: false, safety_checked: true });
});

test("simple English and every Indian language are transformed only after safety validation", async () => {
  const original = "Take Aspirin 5 mg on 2026-09-20. Contact your clinician urgently.";
  for (const language of ["en-simple", "hi", "bn", "mr", "ta", "te", "kn", "gu", "pa", "ml"] as const) {
    const translated = `Safe ${language}: Take Aspirin 5 mg on 2026-09-20. Contact your clinician urgently.`;
    const result = await localizeVerifiedResponse(original, { language }, provider(translated));
    assert.equal(result.answer, translated, language);
    assert.equal(result.metadata.safety_checked, true);
    assert.equal(result.metadata.translated, language !== "en-simple");
  }
});

test("translation failure or changed medical values falls back to the original grounded answer", async () => {
  const original = "Take Aspirin 5 mg on 2026-09-20. Contact your clinician urgently.";
  const changedValue = await localizeVerifiedResponse(original, { language: "hi" }, provider("Aspirin 10 mg"));
  assert.equal(changedValue.answer, original);
  const failedProvider: LlmProvider = { ...provider(""), async chat() { throw new Error("provider unavailable"); } };
  const failed = await localizeVerifiedResponse(original, { language: "ta" }, failedProvider);
  assert.equal(failed.answer, original);
});
