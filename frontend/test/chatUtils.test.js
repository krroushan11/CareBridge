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
      requests.push(body.message);
      return { answer: `Response for ${body.message}` };
    },
  });

  await handler({ currentTarget: form, preventDefault() {} });
  messages.push(form.message.textContent);
  await handler({ currentTarget: form, preventDefault() {} });
  messages.push(form.message.textContent);

  assert.deepEqual(requests, [
    "Hlw",
    "What does my verified care plan say about my follow-up?",
  ]);
  assert.deepEqual(messages, [
    "Response for Hlw",
    "Response for What does my verified care plan say about my follow-up?",
  ]);
  assert.equal(form.resetCount, 2);
});
