import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import { createPushSubscription, deletePushSubscription } from "../src/controllers/pushSubscriptionController";

const OWNER_ID = "a0000000-0000-4000-8000-000000000001";
const originalQuery = pool.query.bind(pool);
const response = () => ({
  statusCode: 200, body: undefined as any,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
});

after(async () => {
  (pool as any).query = originalQuery;
  await pool.end();
});

test("push subscription rejects extra fields and malformed endpoint", async () => {
  let called = false;
  (pool as any).query = async () => { called = true; return { rows: [] }; };
  const res = response();
  await createPushSubscription({
    user: { id: OWNER_ID },
    body: { endpoint: "not-a-url", keys: { p256dh: "key", auth: "auth" }, extra: true },
  } as any, res);
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test("push subscription saves owner keys and deletes only the owner record", async () => {
  const calls: unknown[][] = [];
  (pool as any).query = async (query: string, values: unknown[]) => {
    calls.push(values);
    if (query.startsWith("SELECT")) return { rows: [] };
    if (query.startsWith("INSERT")) return { rows: [{ id: "subscription-id", endpoint: "https://push.example/sub" }] };
    return { rows: [{ id: "subscription-id" }] };
  };
  const createRes = response();
  await createPushSubscription({
    user: { id: OWNER_ID },
    body: { endpoint: "https://push.example/sub", keys: { p256dh: "public", auth: "secret" } },
  } as any, createRes);
  assert.equal(createRes.statusCode, 201);
  assert.deepEqual(calls[1], [OWNER_ID, "https://push.example/sub", "public", "secret"]);

  const deleteRes = response();
  await deletePushSubscription({ user: { id: OWNER_ID }, params: { id: "subscription-id" } } as any, deleteRes);
  assert.equal(deleteRes.statusCode, 200);
  assert.deepEqual(calls[2], ["subscription-id", OWNER_ID]);
});
