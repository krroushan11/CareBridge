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
  // A scheduled item is an appointment that has been arranged, not an
  // outstanding task. Keep it out of the overdue count until it is pending.
  if (!date || TERMINAL_STATUSES.has(record?.status) || record?.status === "missed" || record?.status === "scheduled") return false;
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

export const medicationDoseStatus = (dose, now = new Date()) => {
  if (!dose || !dose.scheduled_at) return "upcoming";
  if (dose.status === "taken") return "completed";
  if (dose.status === "missed") return "missed";
  if (dose.status === "skipped") return "completed";
  const scheduledAt = new Date(dose.scheduled_at).getTime();
  if (Number.isNaN(scheduledAt)) return "upcoming";
  return scheduledAt <= now.getTime() ? "due" : "upcoming";
};

export const medicationStatusLabel = (dose) => {
  const status = medicationDoseStatus(dose);
  return { upcoming: "Upcoming", due: "Due", completed: "Completed", missed: "Missed" }[status] || "Upcoming";
};

export const buildMedicationSchedule = (medications = [], analytics = {}) => {
  const items = [];

  medications.forEach((medication) => {
    const doseList = Array.isArray(medication.today_doses) ? medication.today_doses : [];
    doseList.forEach((dose) => {
      items.push({
        ...dose,
        medication_id: medication.id,
        medication_name: medication.name || medication.medication_name || dose.medication_name || "Medication",
        dosage: medication.dosage || dose.dosage,
        dosage_unit: medication.dosage_unit || dose.dosage_unit,
      });
    });
  });

  (analytics.upcoming_doses || []).forEach((dose) => {
    items.push({
      ...dose,
      medication_name: dose.medication_name || "Medication",
    });
  });

  (analytics.recent_missed_doses || []).forEach((dose) => {
    items.push({
      ...dose,
      medication_name: dose.medication_name || "Medication",
    });
  });

  return [...items].sort((a, b) => { 
    const valueA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
    const valueB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
    return valueA - valueB;
  });
};

export const aggregateMedicationAdherence = (medications = []) => {
  const totalMedications = medications.filter((medication) => medication.active !== false).length;
  const todayMedications = medications.filter((medication) => Array.isArray(medication.today_doses) && medication.today_doses.length > 0).length;
  const scheduled = medications.reduce((total, medication) => total + Number(medication.adherence?.eligible_doses || 0), 0);
  const completed = medications.reduce((total, medication) => total + Number(medication.adherence?.taken_doses || 0), 0);
  const missed = medications.reduce((total, medication) => total + Number(medication.adherence?.missed_doses || 0), 0);

  return {
    totalMedications,
    todayMedications,
    scheduledDoses: scheduled,
    completedDoses: completed,
    missedDoses: missed,
    adherencePercentage: scheduled === 0 ? 0 : Number(((completed / scheduled) * 100).toFixed(1)),
  };
};

export const buildCareManagementSummary = ({ medications = [], followUps = [], medicalTests = [] }, now = new Date()) => {
  const activeFollowUps = [...followUps].filter((record) => record && !["completed", "cancelled"].includes(record.status)).sort((a, b) => {
    const aDate = effectiveDate(a) ? new Date(`${String(effectiveDate(a)).slice(0, 10)}T00:00:00Z`).getTime() : Number.MAX_SAFE_INTEGER;
    const bDate = effectiveDate(b) ? new Date(`${String(effectiveDate(b)).slice(0, 10)}T00:00:00Z`).getTime() : Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
  const activeMedicalTests = [...medicalTests].filter((record) => record && !["completed", "cancelled"].includes(record.status)).sort((a, b) => {
    const aDate = effectiveDate(a) ? new Date(`${String(effectiveDate(a)).slice(0, 10)}T00:00:00Z`).getTime() : Number.MAX_SAFE_INTEGER;
    const bDate = effectiveDate(b) ? new Date(`${String(effectiveDate(b)).slice(0, 10)}T00:00:00Z`).getTime() : Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });

  const medicationSummary = aggregateMedicationAdherence(medications);
  const nextMedication = medications
    .filter((medication) => Array.isArray(medication.today_doses) && medication.today_doses.length > 0)
    .sort((a, b) => {
      const aDate = a.today_doses[0]?.scheduled_at ? new Date(a.today_doses[0].scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bDate = b.today_doses[0]?.scheduled_at ? new Date(b.today_doses[0].scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    })[0];

  return {
    medication: medicationSummary,
    nextMedication,
    nextFollowUp: activeFollowUps[0] || null,
    nextMedicalTest: activeMedicalTests[0] || null,
    pendingRecoveryTasks: [...activeFollowUps, ...activeMedicalTests].filter((record) => record && record.status !== "completed" && record.status !== "cancelled").length,
    createdAt: now.toISOString(),
  };
};
