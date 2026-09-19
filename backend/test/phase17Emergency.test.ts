import assert from "node:assert/strict";
import { test } from "node:test";
import { assessEmergency } from "../src/services/emergencySafety";
import { createChatTurn } from "../src/services/chatService";

const cases: Array<[string, string]> = [
  ["I cannot breathe", "breathing"],
  ["I have severe chest pressure", "chest"],
  ["My face is drooping and speech is slurred", "stroke"],
  ["The bleeding won't stop", "bleeding"],
  ["They are unresponsive", "seizure-or-unresponsive"],
  ["I am having an anaphylactic reaction", "anaphylaxis"],
  ["I want to kill myself", "self-harm"],
  ["I may have taken too much medication", "overdose"],
];

for (const [message, category] of cases) {
  test(`classifies ${category} as an emergency`, () => {
    const result = assessEmergency(message);
    assert.equal(result.severity, "EMERGENCY");
    assert.equal(result.category, category);
    assert.match(result.response || "", /local emergency service|emergency department/i);
  });
}

test("classifies non-emergency content as NONE", () => {
  assert.deepEqual(assessEmergency("What does my verified care plan say?"), { severity: "NONE" });
});

test("classifies explicit urgent-care requests as URGENT", () => {
  const result = assessEmergency("I need urgent medical attention today");
  assert.equal(result.severity, "URGENT");
  assert.equal(result.category, "urgent-care");
  assert.match(result.response || "", /urgent medical care/i);
});

test("emergency chat turns bypass indexing, embeddings, retrieval, and chat", async () => {
  const calls: string[] = [];
  const provider = {
    async extract() { calls.push("extract"); return {}; },
    async embed() { calls.push("embed"); throw new Error("embedding must not run"); },
    async chat() { calls.push("chat"); throw new Error("chat must not run"); },
  };
  let queryCount = 0;
  const client = {
    async query(sql: string) {
      queryCount += 1;
      calls.push(sql.includes("chat_conversations") ? "conversation" : "message");
      if (queryCount === 1) return { rows: [{ id: "conversation-1", created_at: new Date(), updated_at: new Date() }] };
      return { rows: [] };
    },
  };
  const result = await createChatTurn(
    { patientId: "patient-1" },
    "patient-1",
    "I cannot breathe",
    provider as any,
    client as any
  );
  assert.equal(result.emergency?.severity, "EMERGENCY");
  assert.deepEqual(result.citations, []);
  assert.deepEqual(calls, ["conversation", "message"]);
});
