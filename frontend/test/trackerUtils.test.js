import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMedicationAdherence,
  buildCareManagementSummary,
  dashboardMetrics,
  effectiveDate,
  formatTrackingDate,
  isOverdue,
  isReminderEligible,
  medicationDoseStatus,
  reminderReadyItems,
  statusBadgeClass,
} from "../src/trackerUtils.js";

const NOW = new Date("2026-09-18T12:00:00Z");

const followUp = (overrides = {}) => ({
  id: "follow-up-a",
  title: "Cardiology review",
  status: "pending",
  appointment_date: "2026-09-20",
  due_date: null,
  ...overrides,
});

const medicalTest = (overrides = {}) => ({
  id: "test-a",
  test_name: "HbA1c blood test",
  status: "scheduled",
  scheduled_date: "2026-09-19",
  ...overrides,
});

test("status badge classes cover every lifecycle state", () => {
  assert.equal(statusBadgeClass("pending"), "badge-pending");
  assert.equal(statusBadgeClass("scheduled"), "badge-scheduled");
  assert.equal(statusBadgeClass("completed"), "badge-completed");
  assert.equal(statusBadgeClass("cancelled"), "badge-cancelled");
  assert.equal(statusBadgeClass("missed"), "badge-missed");
  assert.equal(statusBadgeClass("unknown"), "badge-pending");
});

test("effective date prefers appointment date then due date then scheduled date", () => {
  assert.equal(effectiveDate(followUp()), "2026-09-20");
  assert.equal(effectiveDate(followUp({ appointment_date: null, due_date: "2026-09-25" })), "2026-09-25");
  assert.equal(effectiveDate(medicalTest()), "2026-09-19");
  assert.equal(effectiveDate({ status: "pending" }), null);
  assert.equal(effectiveDate(null), null);
});

test("overdue detection ignores terminal statuses and records without dates", () => {
  assert.equal(isOverdue(followUp({ appointment_date: "2026-09-01" }), NOW), true);
  assert.equal(isOverdue(followUp({ appointment_date: "2026-09-20" }), NOW), false);
  assert.equal(isOverdue(followUp({ status: "completed", appointment_date: "2026-09-01" }), NOW), false);
  assert.equal(isOverdue(followUp({ status: "cancelled", appointment_date: "2026-09-01" }), NOW), false);
  assert.equal(isOverdue(followUp({ status: "missed", appointment_date: "2026-09-01" }), NOW), false);
  assert.equal(isOverdue(followUp({ appointment_date: null, due_date: null }), NOW), false);
});

test("reminder eligibility requires an id and a non-terminal status", () => {
  assert.equal(isReminderEligible(followUp()), true);
  assert.equal(isReminderEligible(medicalTest()), true);
  assert.equal(isReminderEligible(followUp({ status: "completed" })), false);
  assert.equal(isReminderEligible(followUp({ status: "missed" })), false);
  assert.equal(isReminderEligible({ status: "pending", appointment_date: "2026-09-20" }), false);
});

test("reminder-ready items stay inside the window, drop missing dates, and dedupe", () => {
  const items = [
    followUp(),
    medicalTest(),
    followUp({ id: "follow-up-b", appointment_date: "2026-12-01" }),
    followUp({ id: "follow-up-c", appointment_date: null, due_date: null }),
    followUp({ id: "follow-up-d", status: "completed", appointment_date: "2026-09-19" }),
    { ...medicalTest() },
  ];

  const ready = reminderReadyItems(items, 14, NOW);
  assert.deepEqual(ready.map((item) => item.id), ["test-a", "follow-up-a"]);
});

test("tracking dates format safely without inventing a date", () => {
  assert.equal(formatTrackingDate(null), "No date set");
  assert.equal(formatTrackingDate(""), "No date set");
  assert.equal(formatTrackingDate("not-a-date"), "Invalid date");
  assert.match(formatTrackingDate("2026-10-01"), /2026/);
});

test("dashboard metrics count statuses and overdue records per kind", () => {
  const metrics = dashboardMetrics(
    [
      followUp({ id: "a", status: "pending", appointment_date: "2026-09-01" }),
      followUp({ id: "b", status: "scheduled", appointment_date: "2026-09-20" }),
      followUp({ id: "c", status: "completed", appointment_date: "2026-09-01" }),
    ],
    [
      medicalTest({ id: "d", status: "scheduled", scheduled_date: "2026-09-19" }),
      medicalTest({ id: "e", status: "pending", scheduled_date: "2026-08-01" }),
    ]
  );

  assert.deepEqual(metrics.follow_ups, { total: 3, pending: 1, scheduled: 1, completed: 1, cancelled: 0, missed: 0, overdue: 1 });
  assert.deepEqual(metrics.medical_tests, { total: 2, pending: 1, scheduled: 1, completed: 0, cancelled: 0, overdue: 1 });
  assert.deepEqual(dashboardMetrics().follow_ups.total, 0);
});

test("medication dose status distinguishes upcoming, due, completed, and missed states", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  assert.equal(medicationDoseStatus({ scheduled_at: "2026-09-18T09:00:00Z", status: "scheduled" }, now), "due");
  assert.equal(medicationDoseStatus({ scheduled_at: "2026-09-18T14:00:00Z", status: "scheduled" }, now), "upcoming");
  assert.equal(medicationDoseStatus({ scheduled_at: "2026-09-18T09:00:00Z", status: "taken" }, now), "completed");
  assert.equal(medicationDoseStatus({ scheduled_at: "2026-09-18T09:00:00Z", status: "missed" }, now), "missed");
});

test("adherence analytics aggregate across drugs and handle zero-dose cases safely", () => {
  assert.deepEqual(aggregateMedicationAdherence([]), {
    totalMedications: 0,
    todayMedications: 0,
    scheduledDoses: 0,
    completedDoses: 0,
    missedDoses: 0,
    adherencePercentage: 0,
  });

  const summary = aggregateMedicationAdherence([
    { active: true, adherence: { eligible_doses: 2, taken_doses: 1, missed_doses: 1 } },
    { active: true, adherence: { eligible_doses: 2, taken_doses: 2, missed_doses: 0 } },
  ]);

  assert.equal(summary.totalMedications, 2);
  assert.equal(summary.completedDoses, 3);
  assert.equal(summary.missedDoses, 1);
  assert.equal(summary.adherencePercentage, 75);
});

test("care summary selects next medication, follow-up, and medical test without inventing data", () => {
  const summary = buildCareManagementSummary({
    medications: [
      { id: "med-a", name: "Metformin", active: true, today_doses: [{ scheduled_at: "2026-09-18T08:00:00Z", status: "scheduled" }], adherence: { eligible_doses: 2, taken_doses: 1, missed_doses: 1 } },
      { id: "med-b", name: "Vitamin D", active: true, today_doses: [{ scheduled_at: "2026-09-18T12:00:00Z", status: "taken" }], adherence: { eligible_doses: 1, taken_doses: 1, missed_doses: 0 } },
    ],
    followUps: [
      { id: "fu-a", title: "Cardiology review", status: "pending", appointment_date: "2026-09-20" },
      { id: "fu-b", title: "Nutrition consult", status: "completed", appointment_date: "2026-09-10" },
    ],
    medicalTests: [
      { id: "mt-a", test_name: "HbA1c", status: "scheduled", scheduled_date: "2026-09-22" },
      { id: "mt-b", test_name: "CMP", status: "completed", scheduled_date: "2026-09-12" },
    ],
  }, new Date("2026-09-18T12:00:00Z"));

  assert.equal(summary.medication.adherencePercentage, 66.7);
  assert.equal(summary.nextMedication.name, "Metformin");
  assert.equal(summary.nextFollowUp.title, "Cardiology review");
  assert.equal(summary.nextMedicalTest.test_name, "HbA1c");
  assert.equal(summary.pendingRecoveryTasks, 2);
});
