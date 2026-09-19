import test from "node:test";
import assert from "node:assert/strict";
import { createChatSubmitHandler } from "../src/chatUtils.js";

test("chat form submits two consecutive questions using current values", async () => {
  const requests = [];
  const messages = [];
  const form = {
    values: ["Hlw", "What does my verified care plan say about my follow-up?"],
    querySelector() {
      return this.message;
    },
    reset() {
      this.resetCount = (this.resetCount || 0) + 1;
    },
    message: { textContent: "", className: "" },
  };
  class FormDataStub {
    constructor(target) {
      this.value = target.values.shift();
    }
    get(name) {
      assert.equal(name, "message");
      return this.value;
    }
  }
  const handler = createChatSubmitHandler({
    FormDataConstructor: FormDataStub,
    request: async (_path, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return { answer: `Response for ${body.message}` };
    },
  });

  await handler({ currentTarget: form, preventDefault() {} });
  messages.push(form.message.textContent);
  await handler({ currentTarget: form, preventDefault() {} });
  messages.push(form.message.textContent);

  assert.deepEqual(requests, [
    { message: "Hlw", language: "en", simplify: false },
    { message: "What does my verified care plan say about my follow-up?", language: "en", simplify: false },
  ]);
  assert.deepEqual(messages, [
    "Response for Hlw",
    "Response for What does my verified care plan say about my follow-up?",
  ]);
  assert.equal(form.resetCount, 2);
});

test("chat submission sends the selected language and plain-language mode", async () => {
  const controls = {
    "#chat-message": { textContent: "", className: "" },
    "#chat-language": { value: "ta" },
    "#chat-simplify": { checked: true },
    "button[type=submit]": { disabled: false },
  };
  const form = { querySelector: (selector) => controls[selector], reset() {} };
  class FormDataStub { get() { return "What does my plan say?"; } }
  let payload;
  await createChatSubmitHandler({ FormDataConstructor: FormDataStub, request: async (_path, options) => {
    payload = JSON.parse(options.body);
    return { answer: "Verified response" };
  } })({ currentTarget: form, preventDefault() {} });
  assert.deepEqual(payload, { message: "What does my plan say?", language: "ta", simplify: true });
  assert.equal(controls["button[type=submit]"].disabled, false);
});
