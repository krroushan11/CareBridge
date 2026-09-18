import assert from "node:assert/strict";
import test from "node:test";
import {
  claimUndeliveredDoses,
  findDueDoses,
  readReminderSoundPreference,
  shouldPlayReminderSound,
  shouldPollReminders,
  shouldRequestNotificationPermission,
  writeReminderSoundPreference,
} from "../src/reminderUtils.js";

const dueDose = { id: "dose-a", status: "scheduled", scheduled_at: "2026-09-16T08:00:00.000Z" };

test("due medication detection includes due doses and excludes future or snoozed doses", () => {
  const now = Date.parse("2026-09-16T08:05:00.000Z");
  const futureDose = { id: "dose-b", status: "scheduled", scheduled_at: "2026-09-16T09:00:00.000Z" };
  assert.deepEqual(findDueDoses({ dueDoses: [dueDose], upcomingDoses: [futureDose], now }), [dueDose]);
  assert.deepEqual(findDueDoses({
    dueDoses: [dueDose], now, snoozedUntilById: new Map([[dueDose.id, now + 60_000]]),
  }), []);
});

test("reminders are delivered only once per dose ID", () => {
  const delivered = new Set();
  assert.deepEqual(claimUndeliveredDoses([dueDose], delivered), [dueDose]);
  assert.deepEqual(claimUndeliveredDoses([dueDose], delivered), []);
});

test("reminder sound preference requires an enabled preference and unlocked audio", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readReminderSoundPreference(storage), false);
  writeReminderSoundPreference(storage, true);
  assert.equal(readReminderSoundPreference(storage), true);
  assert.equal(shouldPlayReminderSound(true, true), true);
  assert.equal(shouldPlayReminderSound(true, false), false);
});

test("notification permission is requested only from the default permission state", () => {
  assert.equal(shouldRequestNotificationPermission("default"), true);
  assert.equal(shouldRequestNotificationPermission("granted"), false);
  assert.equal(shouldRequestNotificationPermission("denied"), false);
});

test("muted reminders are not eligible for polling side effects", () => {
  assert.equal(shouldPollReminders(false), true);
  assert.equal(shouldPollReminders(true), false);
});
