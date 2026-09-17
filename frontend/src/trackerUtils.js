// Phase 11: pure helpers for follow-up and medical-test tracking UI.

export const FOLLOW_UP_STATUSES = ["pending", "scheduled", "completed", "cancelled", "missed"];
export const MEDICAL_TEST_STATUSES = ["pending", "scheduled", "completed", "cancelled"];

// Terminal statuses never surface reminder actions in the UI.
export const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

export const statusBadgeClass = (status) => {
  switch (status) {
    case "completed": return "badge-completed";
    case "cancelled": return "badge-cancelled";
    case "missed": return "badge-missed";
    case "scheduled": return "badge-scheduled";
    default: return "badge-pending";
  }
};

// Effective tracking date: appointment date wins for follow-ups, with a due
// date fallback. Medical tests always use their scheduled date.
export const effectiveDate = (record) => record?.appointment_date || record?.due_date || record?.scheduled_date || null;

export const isOverdue = (record, now = new Date()) => {
  const date = effectiveDate(record);
  if (!date || TERMINAL_STATUSES.has(record?.status) || record?.status === "missed") return false;
  const endOfDay = new Date(`${String(date).slice(0, 10)}T23:59:59.999Z`);
  return !Number.isNaN(endOfDay.getTime()) && endOfDay.getTime() < now.getTime();
};

export const isReminderEligible = (record) =>
  Boolean(record?.id) &&
  !TERMINAL_STATUSES.has(record?.status) &&
  record?.status !== "missed";

/**
 * Reminder-ready items from API data: active statuses only, dates within the
 * window (or overdue), deduplicated by ID. Missing dates never fabricate a
 * reminder date.
 */
export const reminderReadyItems = (items = [], windowDays = 14, now = new Date()) => {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const horizon = startOfToday + windowDays * 24 * 60 * 60 * 1000;
  const unique = new Map();

  items.forEach((item) => {
    if (!isReminderEligible(item)) return;
    const date = effectiveDate(item);
    if (!date) return;
    const target = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(target.getTime())) return;
    if (target.getTime() > horizon) return;
    if (unique.has(item.id)) return;
    unique.set(item.id, item);
  });

  return [...unique.values()].sort((a, b) => {
    const dateA = String(effectiveDate(a));
    const dateB = String(effectiveDate(b));
    return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
  });
};

export const formatTrackingDate = (value) => {
  if (!value) return "No date set";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
};

export const dashboardMetrics = (followUps = [], medicalTests = []) => {
  const metrics = {
    follow_ups: { total: followUps.length, pending: 0, scheduled: 0, completed: 0, cancelled: 0, missed: 0, overdue: 0 },
    medical_tests: { total: medicalTests.length, pending: 0, scheduled: 0, completed: 0, cancelled: 0, overdue: 0 },
  };

  followUps.forEach((record) => {
    if (metrics.follow_ups[record.status] !== undefined) metrics.follow_ups[record.status] += 1;
    if (isOverdue(record)) metrics.follow_ups.overdue += 1;
  });

  medicalTests.forEach((record) => {
    if (metrics.medical_tests[record.status] !== undefined) metrics.medical_tests[record.status] += 1;
    if (isOverdue(record)) metrics.medical_tests.overdue += 1;
  });

  return metrics;
};
