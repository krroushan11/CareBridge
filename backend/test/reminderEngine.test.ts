import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/config/database";
import {
  deliverPendingReminders,
  generateReminders,
  startReminderScheduler,
  stopReminderScheduler,
} from "../src/services/reminderEngine";
import { listUnreadNotifications, markNotificationRead } from "../src/controllers/notificationController";

const originalQuery = pool.query.bind(pool);
const OWNER_ID = "a0000000-0000-4000-8000-000000000001";

const response = () => ({
  statusCode: 200, body: undefined as any,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
});

after(async () => {
  stopReminderScheduler();
  (pool as any).query = originalQuery;
  await pool.end();
});

test("reminder generation uses all sources, excludes null dates, and deduplicates", async () => {
  let query = "";
  (pool as any).query = async (sql: string) => {
    query = sql;
    return { rowCount: 1, rows: [{ id: "notification-id" }] };
  };
  assert.equal(await generateReminders(2), 1);
  assert.match(query, /UNION ALL/);
  assert.match(query, /IS NOT NULL/);
  assert.match(query, /ON CONFLICT \(user_id, dedupe_key\) DO NOTHING/);
});

test("delivery without configured email is an explicit safe skipped transition", async () => {
  delete process.env.EMAIL_REMINDERS_ENABLED;
  const updates: string[] = [];
  (pool as any).query = async (sql: string) => {
    if (sql.startsWith("SELECT n.id")) return {
      rows: [{ id: "notification-id", email: "owner@example.com", title: "Reminder", body: "Take medicine" }],
    };
    updates.push(sql);
    return { rows: [] };
  };
  await deliverPendingReminders();
  assert.match(updates[0], /delivery_status = \$2/);
});

test("notification reads are owner-scoped and transition only the unread record", async () => {
  let captured: unknown[] = [];
  (pool as any).query = async (sql: string, values: unknown[]) => {
    captured = values;
    if (sql.includes("SELECT id")) return { rows: [{ id: "n1", status: "unread" }] };
    return { rows: [{ id: "n1", status: "read", read_at: new Date() }] };
  };
  const unread = response();
  await listUnreadNotifications({ user: { id: OWNER_ID }, query: {} } as any, unread);
  assert.equal(unread.statusCode, 200);
  assert.equal(captured[0], OWNER_ID);
  const read = response();
  await markNotificationRead({ user: { id: OWNER_ID }, params: { id: "n1" } } as any, read);
  assert.equal(read.body.notification.status, "read");
});

test("scheduler is singleton-safe", () => {
  const first = startReminderScheduler(60_000);
  const second = startReminderScheduler(60_000);
  assert.equal(first, second);
  stopReminderScheduler();
});
