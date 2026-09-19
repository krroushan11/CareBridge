import test from "node:test";
import assert from "node:assert/strict";
import { createChatSubmitHandler } from "../src/chatUtils.js";

test("emergency response is rendered as an assertive alert", async () => {
  const controls = {
    "#chat-message": {
      textContent: "",
      className: "",
      setAttribute(name, value) { this[name] = value; },
    },
    "button[type=submit]": { disabled: false },
  };
  const form = {
    querySelector: (selector) => controls[selector],
    reset() {},
  };
  class FormDataStub { get() { return "I cannot breathe"; } }
  await createChatSubmitHandler({
    FormDataConstructor: FormDataStub,
    request: async () => ({
      answer: "Contact your local emergency service now.",
      emergency: { severity: "EMERGENCY", category: "breathing" },
    }),
  })({ currentTarget: form, preventDefault() {} });
  assert.equal(controls["#chat-message"].className, "message emergency-alert emergency-emergency");
  assert.equal(controls["#chat-message"].role, "alert");
  assert.equal(controls["#chat-message"]["aria-live"], "assertive");
});
