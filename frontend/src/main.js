import {
  claimUndeliveredDoses,
  findDueDoses,
  readReminderSoundPreference,
  shouldPlayReminderSound,
  shouldPollReminders,
  shouldRequestNotificationPermission,
  writeReminderSoundPreference,
} from "./reminderUtils.js";
import {
  buildCareManagementSummary,
  dashboardMetrics,
  effectiveDate,
  FOLLOW_UP_STATUSES,
  formatTrackingDate,
  isOverdue,
  isReminderEligible,
  MEDICAL_TEST_STATUSES,
  reminderReadyItems,
  statusBadgeClass,
} from "./trackerUtils.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const main = document.querySelector("main");
const tokenKey = "carebridge_token";
const token = () => localStorage.getItem(tokenKey);
const documentId = () => new URLSearchParams(window.location.search).get("document");
const role = () => {
  try { return JSON.parse(atob(token().split(".")[1])).role; } catch { return null; }
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {
    // Push is optional; the application remains usable when registration fails.
  });
}

const registerPushSubscription = async () => {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  if (!("Notification" in window) || Notification.permission !== "granted") return null;
  const paddedKey = `${publicKey}${"=".repeat((4 - (publicKey.length % 4)) % 4)}`.replaceAll("-", "+").replaceAll("_", "/");
  const binaryKey = atob(paddedKey);
  const applicationServerKey = Uint8Array.from(binaryKey, (character) => character.charCodeAt(0));
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const response = await request("/api/notifications/push-subscriptions", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  return response.subscription;
};

const request = async (path, options = {}) => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Request failed");
  return body;
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const formatJson = (value) => JSON.stringify(value ?? [], null, 2);
const fields = ["medications", "findings", "tests", "follow_up", "warnings", "uncertainty_notes"];
let currentExtraction;
let medicationReminderTimer;
let reminderPollGeneration = 0;
let followUpFilters = { status: "", from: "", to: "" };
let medicalTestFilters = { status: "", from: "", to: "" };
const TERMINAL_SET = new Set(["completed", "cancelled"]);
const notifiedDoseIds = new Set();
const soundedDoseIds = new Set();
const snoozedUntilByDoseId = new Map();
let reminderMuted = false;
let reminderAudioContext;

const getReminderAudioContext = () => {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  reminderAudioContext ||= new AudioContextConstructor();
  return reminderAudioContext;
};

const unlockReminderSound = async () => {
  const context = getReminderAudioContext();
  if (!context) return false;
  await context.resume();
  writeReminderSoundPreference(window.localStorage, true);
  return context.state === "running";
};

const playReminderSound = () => {
  const context = getReminderAudioContext();
  if (!context || context.state !== "running") return false;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.7);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.72);
  return true;
};

const clearMedicationReminderTimer = () => {
  if (medicationReminderTimer) window.clearInterval(medicationReminderTimer);
  medicationReminderTimer = undefined;
  reminderPollGeneration += 1;
};

const logout = () => {
  clearMedicationReminderTimer();
  localStorage.removeItem(tokenKey);
  renderAuth();
};

const renderAuth = () => {
  main.innerHTML = `
    <section class="card auth-card">
      <h1>CareBridge AI</h1>
      <p>Sign in to securely review your document-derived information.</p>
      <form id="login-form">
        <label>Email <input required type="email" name="email" autocomplete="email"></label>
        <label>Password <input required type="password" name="password" autocomplete="current-password"></label>
        <button>Sign in</button>
      </form>
      <p id="auth-message" class="message" role="alert"></p>
    </section>`;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = document.querySelector("#auth-message");
    try {
      const result = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      localStorage.setItem(tokenKey, result.token);
      renderApp();
    } catch (error) {
      message.textContent = error.message;
    }
  });
};

const renderClinicianDashboard = async () => {
  main.innerHTML = `<section class="card loading">Loading clinician reviews…</section>`;
  try {
    const result = await request("/api/analysis/clinician/reviews");
    main.innerHTML = `<header class="topbar"><h1>Clinician review queue</h1><button id="logout">Sign out</button></header>
      <section class="card"><p class="disclaimer">Review the source-derived information carefully. Approval is a clinician workflow action, not an automatic diagnosis.</p>
      ${result.reviews.length ? result.reviews.map((review) => `<article class="data-card review-item"><h2>${escapeHtml(review.original_filename)}</h2><p>Status: <strong>${escapeHtml(review.status)}</strong></p><pre>${escapeHtml(JSON.stringify(review.verified_extraction, null, 2))}</pre><textarea data-note="${review.id}" rows="2" placeholder="Optional review note"></textarea><div class="actions"><button data-review="${review.id}" data-status="approved">Approve</button><button class="secondary" data-review="${review.id}" data-status="changes_requested">Request changes</button><button class="secondary" data-review="${review.id}" data-status="rejected">Reject</button></div></article>`).join("") : "<p>No assigned reviews.</p>"}</section>`;
    document.querySelector("#logout").onclick = logout;
    document.querySelectorAll("[data-review]").forEach((button) => button.onclick = async () => {
      const id = button.dataset.review;
      const note = document.querySelector(`[data-note="${id}"]`).value;
      try { await request(`/api/analysis/clinician/reviews/${id}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status, clinician_note: note }) }); renderClinicianDashboard(); }
      catch (error) { window.alert(error.message); }
    });
  } catch (error) {
    main.innerHTML = `<section class="card"><p class="message">${escapeHtml(error.message)}</p></section>`;
  }
};

const medicationLabel = (medication) => [medication.name || medication.medication_name, medication.dosage, medication.dosage_unit].filter(Boolean).join(" ");
const displayDateTime = (value) => new Date(value).toLocaleString();

const trackerQuery = (filters) => {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  return query ? `?${query}` : "";
};

const metricChips = (label, metric) => `
  <p class="metric-row"><strong>${escapeHtml(label)}</strong>
    <span class="chip">Total ${metric.total}</span>
    <span class="chip">Pending ${metric.pending}</span>
    <span class="chip">Scheduled ${metric.scheduled}</span>
    <span class="chip">Completed ${metric.completed}</span>
    ${metric.cancelled !== undefined ? `<span class="chip">Cancelled ${metric.cancelled}</span>` : ""}
    ${metric.missed !== undefined ? `<span class="chip">Missed ${metric.missed}</span>` : ""}
    <span class="chip ${metric.overdue ? "chip-alert" : ""}">Overdue ${metric.overdue}</span>
  </p>`;

const followUpCard = (followUp) => {
  const date = formatTrackingDate(effectiveDate(followUp));
  const time = followUp.appointment_time ? String(followUp.appointment_time).slice(0, 5) : null;
  const active = isReminderEligible(followUp);
  return `<article class="data-card">
    <h3>${escapeHtml(followUp.title)} <span class="badge ${statusBadgeClass(followUp.status)}">${escapeHtml(followUp.status)}</span>${followUp.overdue ? " <span class=\"badge badge-missed\">overdue</span>" : ""}</h3>
    ${followUp.description ? `<p>${escapeHtml(followUp.description)}</p>` : ""}
    ${followUp.provider_or_specialist ? `<p class="muted">With: ${escapeHtml(followUp.provider_or_specialist)}</p>` : ""}
    <p><strong>${date}</strong>${time ? ` at ${escapeHtml(time)}` : ""}${!effectiveDate(followUp) ? " — add a date to enable reminders" : ""}</p>
    <div class="actions">
      ${active && followUp.status !== "completed" ? `<button data-followup-complete="${followUp.id}">Mark complete</button>` : ""}
      ${active && followUp.status !== "scheduled" ? `<button class="secondary" data-followup-status="${followUp.id}" data-value="scheduled">Mark scheduled</button>` : ""}
      ${followUp.status !== "pending" ? `<button class="secondary" data-followup-status="${followUp.id}" data-value="pending">Reopen as pending</button>` : ""}
      ${!TERMINAL_SET.has(followUp.status) ? `<button class="secondary" data-followup-status="${followUp.id}" data-value="cancelled">Cancel</button>` : ""}
      ${!TERMINAL_SET.has(followUp.status) ? `<button class="secondary" data-followup-delete="${followUp.id}">Delete</button>` : ""}
    </div>
  </article>`;
};

const medicalTestCard = (test) => {
  const date = formatTrackingDate(test.scheduled_date);
  const active = isReminderEligible(test);
  return `<article class="data-card">
    <h3>${escapeHtml(test.test_name)} <span class="badge ${statusBadgeClass(test.status)}">${escapeHtml(test.status)}</span>${test.overdue ? " <span class=\"badge badge-missed\">overdue</span>" : ""}</h3>
    ${test.instructions ? `<p>${escapeHtml(test.instructions)}</p>` : ""}
    <p><strong>${date}</strong>${test.result_summary ? ` — Result: ${escapeHtml(test.result_summary)}` : ""}</p>
    <div class="actions">
      ${active && test.status !== "completed" ? `<button data-test-complete="${test.id}">Mark complete</button>` : ""}
      ${active && test.status !== "scheduled" ? `<button class="secondary" data-test-status="${test.id}" data-value="scheduled">Mark scheduled</button>` : ""}
      ${test.status !== "pending" ? `<button class="secondary" data-test-status="${test.id}" data-value="pending">Reopen as pending</button>` : ""}
      ${!TERMINAL_SET.has(test.status) ? `<button class="secondary" data-test-status="${test.id}" data-value="cancelled">Cancel</button>` : ""}
      ${!TERMINAL_SET.has(test.status) ? `<button class="secondary" data-test-delete="${test.id}">Delete</button>` : ""}
    </div>
  </article>`;
};

const filterControls = (kind, filters, statuses) => `
  <div class="filter-row">
    <label>Status
      <select data-filter-kind="${kind}" data-filter-field="status">
        ${["", ...statuses].map((status) => `<option value="${status}" ${filters.status === status ? "selected" : ""}>${status || "All statuses"}</option>`).join("")}
      </select>
    </label>
    <label>From <input type="date" data-filter-kind="${kind}" data-filter-field="from" value="${escapeHtml(filters.from)}"></label>
    <label>To <input type="date" data-filter-kind="${kind}" data-filter-field="to" value="${escapeHtml(filters.to)}"></label>
    <button class="secondary" data-filter-apply="${kind}">Apply filters</button>
  </div>`;

const renderTrackingSections = (followUps, medicalTests, followUpFilterState, testFilterState, metrics) => {
  const upcoming = reminderReadyItems([...followUps, ...medicalTests], 14);
  return `
  <section class="card"><h2>Care tracking overview</h2>
    ${metricChips("Follow-ups", metrics.follow_ups)}
    ${metricChips("Medical tests", metrics.medical_tests)}
    <p class="muted">Metrics come from your saved records and update as statuses change.</p>
  </section>
  <section class="card"><h2>Upcoming actions (next 14 days)</h2>
    ${upcoming.length ? `<ul>${upcoming.map((item) => `<li><strong>${escapeHtml(item.title || item.test_name)}</strong> — ${formatTrackingDate(effectiveDate(item))}${item.appointment_time ? ` at ${escapeHtml(String(item.appointment_time).slice(0, 5))}` : ""} <span class="badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span></li>`).join("")}</ul>` : "<p>No upcoming follow-ups or tests in the next 14 days.</p>"}
  </section>
  <section class="card"><h2>Follow-ups</h2>
    ${filterControls("follow_up", followUpFilterState, FOLLOW_UP_STATUSES)}
    <form id="followup-form"><div class="data-grid">
      <label>Title <input required name="title" maxlength="255" placeholder="e.g. Follow up with cardiology"></label>
      <label>Provider / specialist <input name="provider_or_specialist" maxlength="255"></label>
      <label>Appointment date <input type="date" name="appointment_date"></label>
      <label>Appointment time <input type="time" name="appointment_time"></label>
      <label>Due date (task) <input type="date" name="due_date"></label>
      <label>Status
        <select name="status">${FOLLOW_UP_STATUSES.map((status) => `<option value="${status}" ${status === "pending" ? "selected" : ""}>${status}</option>`).join("")}</select>
      </label>
    </div><label>Description / instructions <textarea name="description" rows="2" maxlength="2000"></textarea></label><button>Add follow-up</button><p id="followup-message" class="message" role="alert"></p></form>
    <div class="data-grid">${followUps.length ? followUps.map(followUpCard).join("") : "<p class=\"muted\">No follow-ups match the current filters.</p>"}</div>
  </section>
  <section class="card"><h2>Medical tests</h2>
    ${filterControls("medical_test", testFilterState, MEDICAL_TEST_STATUSES)}
    <form id="test-form"><div class="data-grid">
      <label>Test name <input required name="test_name" maxlength="255" placeholder="e.g. HbA1c blood test"></label>
      <label>Scheduled date <input type="date" name="scheduled_date"></label>
      <label>Status
        <select name="status">${MEDICAL_TEST_STATUSES.map((status) => `<option value="${status}" ${status === "pending" ? "selected" : ""}>${status}</option>`).join("")}</select>
      </label>
    </div><label>Instructions <textarea name="instructions" rows="2" maxlength="2000"></textarea></label><button>Add medical test</button><p id="test-message" class="message" role="alert"></p></form>
    <div class="data-grid">${medicalTests.length ? medicalTests.map(medicalTestCard).join("") : "<p class=\"muted\">No medical tests match the current filters.</p>"}</div>
  </section>`;
};

const sectionCard = (title, body, className = "card") => `<section class="${className}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
const medicationMetricCard = (title, value, subtext = "") => `
  <article class="data-card">
    <p class="muted">${escapeHtml(title)}</p>
    <h3>${escapeHtml(value)}</h3>
    ${subtext ? `<p class="muted">${escapeHtml(subtext)}</p>` : ""}
  </article>`;

const renderMedicationDashboard = async () => {
  clearMedicationReminderTimer();
  main.innerHTML = `<section class="card loading" aria-live="polite">Loading care management dashboard…</section>`;
  const requestCache = new Map();
  const cachedRequest = (path) => {
    if (!requestCache.has(path)) requestCache.set(path, request(path));
    return requestCache.get(path);
  };
  const medicationsPath = "/api/medications";
  const followUpsPath = () => `/api/follow-ups${trackerQuery(followUpFilters)}`;
  const medicalTestsPath = () => `/api/medical-tests${trackerQuery(medicalTestFilters)}`;

  const medicationSection = async () => {
    try {
      const result = await cachedRequest(medicationsPath);
      const { medications = [], analytics = {} } = result;
      const adherence = analytics.adherence_percentage ?? (medications.length ? medications.reduce((sum, medication) => sum + (medication.adherence?.percentage ?? 0), 0) / medications.length : 0);
      const schedule = buildMedicationSchedule(medications, analytics);
      const upcoming = schedule.filter((dose) => medicationDoseStatus(dose) !== "completed" && medicationDoseStatus(dose) !== "missed").slice(0, 8);
      const summary = aggregateMedicationAdherence(medications);
      return `
        <section class="card">
          <h2>Medication dashboard</h2>
          <div class="data-grid">
            ${medicationMetricCard("Active medications", String(summary.totalMedications), "Current active medication list")}
            ${medicationMetricCard("Today's medications", String(summary.todayMedications), "Medication entries with doses today")}
            ${medicationMetricCard("Completed doses", String(summary.completedDoses), "Completed scheduled doses")}
            ${medicationMetricCard("Missed doses", String(summary.missedDoses), "Missed dose count")}
            ${medicationMetricCard("Upcoming doses", String((analytics.upcoming_doses || []).length), "Scheduled future doses")}
            ${medicationMetricCard("Adherence", `${adherence}${Number.isFinite(adherence) ? "%" : ""}`, "Completed ÷ scheduled doses")}
          </div>
        </section>
        <section class="card">
          <h2>Medication schedule</h2>
          ${upcoming.length ? `<div class="data-grid">${upcoming.map((dose) => `<article class="data-card"><h3>${escapeHtml(dose.medication_name || medicationLabel(dose))}</h3><p><strong>${escapeHtml(formatTrackingDate(dose.scheduled_at ? dose.scheduled_at.slice(0, 10) : null))}</strong> ${dose.scheduled_at ? escapeHtml(new Date(dose.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : ""}</p><p>Dosage: ${escapeHtml([dose.dosage, dose.dosage_unit].filter(Boolean).join(" ") || "Not specified")}</p><p>Status: <span class="badge ${statusBadgeClass(dose.status === "scheduled" ? "scheduled" : dose.status === "taken" ? "completed" : dose.status === "missed" ? "missed" : "pending")}">${escapeHtml(medicationStatusLabel(dose))}</span></p>${dose.status === "scheduled" ? `<div class="actions"><button data-dose-action="taken" data-medication-id="${dose.medication_id}" data-scheduled-at="${dose.scheduled_at}">Taken</button><button class="secondary" data-dose-action="skipped" data-medication-id="${dose.medication_id}" data-scheduled-at="${dose.scheduled_at}">Skipped</button></div>` : ""}</article>`).join("")}</div>` : `<p>No medications scheduled.</p>`}
        </section>
        <section class="card">
          <h2>Adherence analytics</h2>
          <div class="data-grid">
            ${medicationMetricCard("Overall adherence", `${adherence}%`, "Across all scheduled eligible doses")}
            ${medicationMetricCard("Completed", String(summary.completedDoses), "Doses marked as taken")}
            ${medicationMetricCard("Missed", String(summary.missedDoses), "Doses missed or overdue")}
            ${medicationMetricCard("Upcoming", String((analytics.upcoming_doses || []).length), "Scheduled for future dates")}
          </div>
        </section>
      `;
    } catch (error) {
      return sectionCard("Medication", `<p class="message">${escapeHtml(error.message || "Unable to load medications")}</p><button class="secondary" data-retry-section="medication">Retry</button>`);
    }
  };

  const followUpSection = async () => {
    try {
      const result = await cachedRequest(followUpsPath());
      const followUps = result.follow_ups || [];
      const summary = followUps.slice(0, 5);
      return `
        <section class="card">
          <h2>Upcoming follow-ups</h2>
          ${summary.length ? `<div class="data-grid">${summary.map((item) => `<article class="data-card"><h3>${escapeHtml(item.title)}</h3><p><strong>${escapeHtml(formatTrackingDate(effectiveDate(item)))}</strong>${item.appointment_time ? ` at ${escapeHtml(String(item.appointment_time).slice(0, 5))}` : ""}</p><p>Status: <span class="badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span>${item.overdue ? " <span class=\"badge badge-missed\">overdue</span>" : ""}</p>${item.provider_or_specialist ? `<p class="muted">With: ${escapeHtml(item.provider_or_specialist)}</p>` : ""}</article>`).join("")}</div>` : `<p>No upcoming follow-ups.</p>`}
        </section>
      `;
    } catch (error) {
      return sectionCard("Follow-ups", `<p class="message">${escapeHtml(error.message || "Failed to retrieve follow-ups")}</p><button class="secondary" data-retry-section="followups">Retry</button>`);
    }
  };

  const medicalTestSection = async () => {
    try {
      const result = await cachedRequest(medicalTestsPath());
      const medicalTests = result.medical_tests || [];
      const summary = medicalTests.slice(0, 5);
      return `
        <section class="card">
          <h2>Medical test status</h2>
          ${summary.length ? `<div class="data-grid">${summary.map((item) => `<article class="data-card"><h3>${escapeHtml(item.test_name)}</h3><p><strong>${escapeHtml(formatTrackingDate(item.scheduled_date))}</strong></p><p>Status: <span class="badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span>${item.overdue ? " <span class=\"badge badge-missed\">overdue</span>" : ""}</p>${item.result_summary ? `<p>Result: ${escapeHtml(item.result_summary)}</p>` : ""}</article>`).join("")}</div>` : `<p>No medical tests scheduled.</p>`}
        </section>
      `;
    } catch (error) {
      return sectionCard("Medical tests", `<p class="message">${escapeHtml(error.message || "Failed to retrieve medical tests")}</p><button class="secondary" data-retry-section="medicaltests">Retry</button>`);
    }
  };

  const recoverySection = async () => {
    try {
      const [followUpResult, testResult] = await Promise.all([
        cachedRequest(followUpsPath()),
        cachedRequest(medicalTestsPath()),
      ]);
      const tasks = [...(followUpResult.follow_ups || []), ...(testResult.medical_tests || [])]
        .filter((item) => !["completed", "cancelled"].includes(item.status))
        .slice(0, 8);
      return `
        <section class="card">
          <h2>Recovery tasks</h2>
          ${tasks.length ? `<div class="data-grid">${tasks.map((item) => `<article class="data-card"><h3>${escapeHtml(item.title || item.test_name)}</h3><p><strong>${escapeHtml(formatTrackingDate(effectiveDate(item)))}</strong></p><p>Status: <span class="badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span></p>${item.provider_or_specialist ? `<p class="muted">${escapeHtml(item.provider_or_specialist)}</p>` : ""}</article>`).join("")}</div>` : `<p>No recovery tasks.</p>`}
        </section>
      `;
    } catch (error) {
      return sectionCard("Recovery tasks", `<p class="message">${escapeHtml(error.message || "Failed to retrieve recovery tasks")}</p><button class="secondary" data-retry-section="recovery">Retry</button>`);
    }
  };

  try {
    const [medicationHtml, followUpHtml, testHtml, recoveryHtml] = await Promise.all([
      medicationSection(),
      followUpSection(),
      medicalTestSection(),
      recoverySection(),
    ]);
    const reminderPermission = "Notification" in window ? Notification.permission : "unsupported";
    const soundEnabled = readReminderSoundPreference(window.localStorage);
    const defaultSummary = {
      medication: { totalMedications: 0, todayMedications: 0, scheduledDoses: 0, completedDoses: 0, missedDoses: 0, adherencePercentage: 0 },
      nextMedication: null,
      nextFollowUp: null,
      nextMedicalTest: null,
      pendingRecoveryTasks: 0,
    };
    const summary = buildCareManagementSummary({
      medications: (await cachedRequest(medicationsPath)).medications || [],
      followUps: (await cachedRequest(followUpsPath())).follow_ups || [],
      medicalTests: (await cachedRequest(medicalTestsPath())).medical_tests || [],
    });
    const summaryState = summary || defaultSummary;
    main.innerHTML = `
      <header class="topbar"><h1>Care management dashboard</h1><button id="logout">Sign out</button></header>
      <section class="card disclaimer"><strong>Care summary</strong><p>Medication adherence ${summaryState.medication.adherencePercentage ?? 0}% • Next medication ${summaryState.nextMedication ? escapeHtml(medicationLabel(summaryState.nextMedication)) : "Not scheduled"} • Next follow-up ${summaryState.nextFollowUp ? escapeHtml(summaryState.nextFollowUp.title) : "Not scheduled"} • Pending recovery tasks ${summaryState.pendingRecoveryTasks}</p></section>
      <section class="card"><h2>Unified care overview</h2><div class="data-grid">${medicationMetricCard("Medication adherence", `${summaryState.medication.adherencePercentage}%`, "Completed divided by scheduled doses")}${medicationMetricCard("Next medication", summaryState.nextMedication ? escapeHtml(medicationLabel(summaryState.nextMedication)) : "Not scheduled", "Next dose in the active schedule")}${medicationMetricCard("Next follow-up", summaryState.nextFollowUp ? escapeHtml(summaryState.nextFollowUp.title) : "No upcoming follow-up", "Next active follow-up")}${medicationMetricCard("Next medical test", summaryState.nextMedicalTest ? escapeHtml(summaryState.nextMedicalTest.test_name) : "No upcoming test", "Next pending or scheduled test")}${medicationMetricCard("Pending recovery tasks", String(summaryState.pendingRecoveryTasks), "Open tasks requiring attention")}</div></section>
      <section class="card"><h2>Reminders</h2><p class="muted">This page checks due doses while it is open. Browser notifications require your permission and may be blocked by your browser or device.</p><div class="actions"><button class="secondary" id="enable-reminders" ${reminderPermission === "granted" || reminderPermission === "unsupported" ? "disabled" : ""}>${reminderPermission === "granted" ? "Notifications enabled" : reminderPermission === "unsupported" ? "Notifications unavailable" : "Enable browser notifications"}</button><button class="secondary" id="enable-reminder-sound">${soundEnabled ? "Reminder sound enabled" : "Enable Reminder Sound"}</button><button class="secondary" id="test-reminder-sound">Test Reminder Sound</button><button class="secondary" id="mute-reminders">Mute reminders for this page</button></div><p id="reminder-message" class="message" role="status"></p></section>
      ${medicationHtml}
      ${followUpHtml}
      ${testHtml}
      ${recoveryHtml}
      ${renderTrackingSections(
        (await cachedRequest(followUpsPath())).follow_ups || [],
        (await cachedRequest(medicalTestsPath())).medical_tests || [],
        followUpFilters,
        medicalTestFilters,
        dashboardMetrics(
          (await cachedRequest(followUpsPath())).follow_ups || [],
          (await cachedRequest(medicalTestsPath())).medical_tests || [],
        ),
      )}
    `;

    document.querySelector("#logout").onclick = logout;
    document.querySelectorAll("[data-retry-section]").forEach((button) => button.onclick = () => renderMedicationDashboard());

    document.querySelectorAll("[data-dose-action]").forEach((button) => button.onclick = async () => {
      try {
        await request(`/api/medications/${button.dataset.medicationId}/${button.dataset.doseAction}`, { method: "POST", body: JSON.stringify({ scheduled_at: button.dataset.scheduledAt }) });
        renderMedicationDashboard();
      } catch (error) { window.alert(error.message); }
    });

    document.querySelectorAll("[data-filter-apply]").forEach((button) => button.onclick = () => {
      const kind = button.dataset.filterApply;
      const target = kind === "follow_up" ? followUpFilters : medicalTestFilters;
      document.querySelectorAll(`[data-filter-kind="${kind}"]`).forEach((input) => {
        target[input.dataset.filterField] = input.value;
      });
      renderMedicationDashboard();
    });

    document.querySelector("#enable-reminders").onclick = async () => {
      const message = document.querySelector("#reminder-message");
      if (!("Notification" in window) || !shouldRequestNotificationPermission(Notification.permission)) return;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        message.textContent = "Browser notification permission was not granted.";
        return;
      }
      try {
        await registerPushSubscription();
        message.textContent = "Browser notifications enabled while this page is open.";
      } catch (error) {
        message.textContent = `Browser notifications enabled for this page, but push setup failed: ${error.message || "configuration unavailable"}`;
      }
    };
    document.querySelector("#enable-reminder-sound").onclick = async () => {
      const message = document.querySelector("#reminder-message");
      try {
        const unlocked = await unlockReminderSound();
        message.textContent = unlocked ? "Reminder sound enabled for this browser." : "Reminder sound is not supported by this browser.";
        if (unlocked) document.querySelector("#enable-reminder-sound").textContent = "Reminder sound enabled";
      } catch { message.textContent = "Reminder sound could not be enabled. Try again after interacting with the page."; }
    };
    document.querySelector("#test-reminder-sound").onclick = async () => {
      const message = document.querySelector("#reminder-message");
      try {
        const unlocked = await unlockReminderSound();
        message.textContent = unlocked && playReminderSound() ? "Reminder sound played." : "Reminder sound is not supported by this browser.";
      } catch { message.textContent = "Reminder sound could not be played."; }
    };
    document.querySelector("#mute-reminders").onclick = () => { reminderMuted = true; document.querySelector("#reminder-message").textContent = "Reminders muted until this dashboard is reloaded."; };

    const pollGeneration = reminderPollGeneration;
    const medicationNotification = async () => {
      if (!shouldPollReminders(reminderMuted) || pollGeneration !== reminderPollGeneration || !token()) return;
      try {
        const medResult = await request(medicationsPath);
        if (!shouldPollReminders(reminderMuted) || pollGeneration !== reminderPollGeneration || !token()) return;
      const analytics = medResult.analytics || {};
      const due = findDueDoses({ dueDoses: analytics.due_doses || [], upcomingDoses: analytics.upcoming_doses || [], snoozedUntilById: snoozedUntilByDoseId });
      if ("Notification" in window && Notification.permission === "granted") {
        claimUndeliveredDoses(due, notifiedDoseIds).forEach((dose) => new Notification("CareBridge medication reminder", { body: `${medicationLabel(dose)} is due now.` }));
      }
      if (shouldPlayReminderSound(readReminderSoundPreference(window.localStorage), reminderAudioContext?.state === "running")) {
        claimUndeliveredDoses(due, soundedDoseIds).forEach(() => playReminderSound());
      }
      } catch (error) {
        const message = document.querySelector("#reminder-message");
        if (message && shouldPollReminders(reminderMuted) && pollGeneration === reminderPollGeneration) {
          message.textContent = `Reminder polling failed: ${error.message || "Unable to check medication reminders."}`;
        }
      }
    };
    medicationNotification();
    medicationReminderTimer = window.setInterval(medicationNotification, 60_000);
  } catch (error) {
    clearMedicationReminderTimer();
    main.innerHTML = `<section class="card"><h1>Unable to load care management dashboard</h1><p class="message">${escapeHtml(error.message)}</p><button id="retry">Try again</button></section>`;
    document.querySelector("#retry").onclick = renderMedicationDashboard;
  }
};

const editor = (extraction) => fields.map((field) => `
  <label class="editor-field">${field.replaceAll("_", " ")}
    <textarea data-field="${field}" rows="${field === "patient_summary" ? 3 : 5}">${escapeHtml(formatJson(extraction[field]))}</textarea>
    <small>JSON array. Keep only information supported by the source document.</small>
  </label>`).join("") + `
  <label class="editor-field">patient summary
    <textarea data-field="patient_summary" rows="3">${escapeHtml(extraction.patient_summary || "")}</textarea>
  </label>`;

const extractionCards = (extraction) => fields.map((field) => {
  const value = extraction?.[field] || [];
  return `<section class="data-card"><h3>${field.replaceAll("_", " ")}</h3>${
    Array.isArray(value)
      ? value.length ? `<ul>${value.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : JSON.stringify(item))}</li>`).join("")}</ul>` : "<p>None reported.</p>"
      : `<p>${escapeHtml(value)}</p>`
  }</section>`;
}).join("") + `<section class="data-card"><h3>patient summary</h3><p>${escapeHtml(extraction?.patient_summary)}</p></section>`;

const renderApp = async () => {
  clearMedicationReminderTimer();
  if (!token()) return renderAuth();
  if (!documentId()) {
    if (role() === "doctor") return renderClinicianDashboard();
    return renderMedicationDashboard();
  }
  main.innerHTML = `<section class="card loading" aria-live="polite">Loading secure review…</section>`;
  try {
    const [review, versions, audit] = await Promise.all([
      request(`/api/analysis/${documentId()}/review`),
      request(`/api/analysis/${documentId()}/versions`),
      request(`/api/analysis/${documentId()}/audit`),
    ]);
    currentExtraction = review.extraction;
    if (!currentExtraction) {
      main.innerHTML = `<section class="card"><h1>No extraction available</h1><p>Structured extraction is not ready for this document.</p></section>`;
      return;
    }
    main.innerHTML = `
      <header class="topbar"><h1>Review extracted information</h1><div class="actions"><button class="secondary" id="medications">Medications</button><button id="logout">Sign out</button></div></header>
      <section class="card disclaimer"><strong>Medical disclaimer</strong><p>${escapeHtml(review.disclaimer)}</p></section>
      <section class="card"><h2>Source document</h2><p>${escapeHtml(review.document.original_filename)}</p><p class="muted">AI output is informational and remains unverified until you confirm it.</p></section>
      <section class="card">
        <h2>AI-extracted information</h2><div class="data-grid">${extractionCards(currentExtraction)}</div>
        <p class="muted">Source-support details are preserved in the structured fields where provided. Missing information is not inferred.</p>
      </section>
      <section class="card">
        <h2>Review and edit</h2>
        <p>These controls edit the extracted data before it is finalized. User edits are validated against the same strict schema and source-support checks.</p>
        <form id="edit-form">${editor(currentExtraction)}
          <div class="actions"><button type="submit">Validate and save edits</button><button type="button" class="secondary" id="revert">Cancel / revert</button></div>
        </form><p id="edit-message" class="message" role="alert"></p>
      </section>
      <section class="card confirm-card"><h2>Final confirmation</h2><p>Review the information above. Confirmation saves this version as your verified care plan; it is not a diagnosis or medical advice.</p><button id="confirm">Confirm reviewed information</button><p id="confirm-message" class="message" role="alert"></p></section>
      <section class="card"><h2>Version history</h2><div id="versions">${versions.versions.length ? versions.versions.map((v) => `<p><strong>Version ${v.version_number}</strong> — ${v.is_current ? "current" : "previous"} — ${new Date(v.confirmed_at).toLocaleString()}</p>`).join("") : "<p>No finalized versions yet.</p>"}</div></section>
      <section class="card"><h2>Review / audit history</h2><div>${audit.events.length ? audit.events.map((event) => `<p><strong>${escapeHtml(event.action)}</strong> — ${new Date(event.created_at).toLocaleString()}</p>`).join("") : "<p>No review events yet.</p>"}</div></section>
      <section class="card"><h2>Optional clinician review</h2><p>A clinician must be an authorized doctor account. AI output is never automatically clinician-approved.</p><form id="clinician-form"><label>Clinician ID <input required name="clinician_id"></label><label>Note <textarea name="patient_note" rows="2"></textarea></label><button class="secondary">Submit for clinician review</button></form><p id="clinician-message" class="message" role="alert"></p></section>`;
    bindReviewHandlers(review);
  } catch (error) {
    main.innerHTML = `<section class="card"><h1>Unable to load review</h1><p class="message">${escapeHtml(error.message)}</p><button id="retry">Try again</button></section>`;
    document.querySelector("#retry").onclick = renderApp;
  }
};

const readEditedExtraction = () => {
  const extraction = { ...currentExtraction };
  for (const field of fields) {
    const value = document.querySelector(`[data-field="${field}"]`).value;
    extraction[field] = JSON.parse(value);
  }
  extraction.patient_summary = document.querySelector('[data-field="patient_summary"]').value.trim();
  return extraction;
};

const bindReviewHandlers = (review) => {
  document.querySelector("#logout").onclick = logout;
  document.querySelector("#medications").onclick = () => { window.history.replaceState({}, "", window.location.pathname); renderApp(); };
  document.querySelector("#revert").onclick = () => { currentExtraction = review.extraction; renderApp(); };
  document.querySelector("#edit-form").onsubmit = async (event) => {
    event.preventDefault();
    const message = document.querySelector("#edit-message");
    try {
      const extraction = readEditedExtraction();
      const result = await request(`/api/analysis/${documentId()}/review`, { method: "PUT", body: JSON.stringify({ extraction }) });
      currentExtraction = result.extraction;
      message.textContent = "Validated edits saved. Review the updated information before confirmation.";
      message.className = "message success";
    } catch (error) {
      message.textContent = error instanceof SyntaxError ? "Each structured field must contain valid JSON." : error.message;
      message.className = "message";
    }
  };
  document.querySelector("#confirm").onclick = async () => {
    const message = document.querySelector("#confirm-message");
    try {
      const extraction = readEditedExtraction();
      const result = await request(`/api/analysis/${documentId()}/confirm`, { method: "POST", body: JSON.stringify({ extraction }) });
      message.textContent = `Confirmed successfully as version ${result.version_number || "current"}.`;
      message.className = "message success";
      document.querySelector("#confirm").disabled = true;
    } catch (error) { message.textContent = error.message; }
  };
  document.querySelector("#clinician-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = document.querySelector("#clinician-message");
    try {
      await request(`/api/analysis/${documentId()}/clinician-review`, { method: "POST", body: JSON.stringify({ clinician_id: form.get("clinician_id"), patient_note: form.get("patient_note") }) });
      message.textContent = "Submitted to the authorized clinician.";
      message.className = "message success";
    } catch (error) { message.textContent = error.message; }
  };
};

main.dataset.apiBaseUrl = apiBaseUrl;
renderApp();
