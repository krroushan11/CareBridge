import {
  claimUndeliveredDoses,
  findDueDoses,
  readReminderSoundPreference,
  shouldPlayReminderSound,
  shouldRequestNotificationPermission,
  writeReminderSoundPreference,
} from "./reminderUtils.js";
import {
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
    document.querySelector("#logout").onclick = () => { localStorage.removeItem(tokenKey); renderAuth(); };
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

const renderMedicationDashboard = async () => {
  main.innerHTML = `<section class="card loading" aria-live="polite">Loading health dashboard…</section>`;
  try {
    const [result, followUpResult, testResult] = await Promise.all([
      request("/api/medications"),
      request(`/api/follow-ups${trackerQuery(followUpFilters)}`),
      request(`/api/medical-tests${trackerQuery(medicalTestFilters)}`),
    ]);
    const { medications, analytics } = result;
    const followUps = followUpResult.follow_ups || [];
    const medicalTests = testResult.medical_tests || [];
    const metrics = dashboardMetrics(followUps, medicalTests);
    const reminderPermission = "Notification" in window ? Notification.permission : "unsupported";
    const soundEnabled = readReminderSoundPreference(window.localStorage);
    const dueDoses = findDueDoses({
      dueDoses: analytics.due_doses || [],
      upcomingDoses: analytics.upcoming_doses || [],
      snoozedUntilById: snoozedUntilByDoseId,
    });
    main.innerHTML = `
      <header class="topbar"><h1>Health dashboard</h1><button id="logout">Sign out</button></header>
      <section class="card disclaimer"><strong>Medication safety</strong><p>Use this tracker to record your medication routine. Confirm medication instructions with your clinician or pharmacist.</p></section>
      <section class="card"><h2>Adherence overview</h2><p><strong>${analytics.adherence_percentage ?? "—"}${analytics.adherence_percentage === null ? "" : "%"}</strong> adherence from ${analytics.taken_doses} taken of ${analytics.eligible_doses} eligible scheduled doses.</p><p class="muted">Skipped: ${analytics.skipped_doses}. Missed: ${analytics.missed_doses}. Future doses are not included in adherence.</p></section>
      <section class="card"><h2>Reminders</h2><p class="muted">This page checks due doses while it is open. Browser notifications require your permission and may be blocked by your browser or device.</p><div class="actions"><button class="secondary" id="enable-reminders" ${reminderPermission === "granted" || reminderPermission === "unsupported" ? "disabled" : ""}>${reminderPermission === "granted" ? "Notifications enabled" : reminderPermission === "unsupported" ? "Notifications unavailable" : "Enable browser notifications"}</button><button class="secondary" id="enable-reminder-sound">${soundEnabled ? "Reminder sound enabled" : "Enable Reminder Sound"}</button><button class="secondary" id="test-reminder-sound">Test Reminder Sound</button><button class="secondary" id="mute-reminders">Mute reminders for this page</button></div><p id="reminder-message" class="message" role="status"></p></section>
      ${dueDoses.length ? `<section class="card disclaimer" id="due-reminders"><h2>Medication due now</h2>${dueDoses.map((dose) => `<article class="data-card"><strong>${escapeHtml(medicationLabel(dose))}</strong><p>Scheduled for ${escapeHtml(displayDateTime(dose.scheduled_at))}.</p><div class="actions"><button data-reminder-taken="${dose.id}" data-medication-id="${dose.medication_id}" data-scheduled-at="${dose.scheduled_at}">Mark as Taken</button><button class="secondary" data-reminder-snooze="${dose.id}">Snooze 10 minutes</button></div></article>`).join("")}</section>` : ""}
      <section class="card"><h2>Add medication</h2><form id="medication-form"><div class="data-grid">
        <label>Medicine name <input required name="name" maxlength="255"></label>
        <label>Dosage <input name="dosage" maxlength="100" placeholder="e.g. 500"></label>
        <label>Unit <input name="dosage_unit" maxlength="30" placeholder="e.g. mg"></label>
        <label>Dose times <input required name="dose_times" placeholder="08:00, 20:00" pattern="^([01]\\d|2[0-3]):[0-5]\\d(,\\s*([01]\\d|2[0-3]):[0-5]\\d)*$"></label>
        <label>Start date <input required type="date" name="start_date" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label>End date <input type="date" name="end_date"></label>
      </div><label>Instructions <textarea name="instructions" rows="2" maxlength="2000"></textarea></label><label>Notes <textarea name="notes" rows="2" maxlength="2000"></textarea></label><button>Add medication</button><p id="medication-message" class="message" role="alert"></p></form></section>
      <section class="card"><h2>Today's medications</h2>${medications.length ? medications.map((medication) => `<article class="data-card"><h3>${escapeHtml(medicationLabel(medication))}</h3><p>${escapeHtml(medication.frequency)} at ${escapeHtml(medication.dose_times.join(", "))}</p><p>Adherence: <strong>${medication.adherence.percentage ?? "—"}${medication.adherence.percentage === null ? "" : "%"}</strong> (${medication.adherence.taken_doses}/${medication.adherence.eligible_doses} eligible doses taken)</p>${medication.today_doses.length ? medication.today_doses.map((dose) => `<p><strong>${escapeHtml(displayDateTime(dose.scheduled_at))}</strong> — ${escapeHtml(dose.status)} ${dose.status === "scheduled" ? `<button data-dose-action="taken" data-medication-id="${medication.id}" data-scheduled-at="${dose.scheduled_at}">Taken</button> <button class="secondary" data-dose-action="skipped" data-medication-id="${medication.id}" data-scheduled-at="${dose.scheduled_at}">Skipped</button>` : ""}</p>`).join("") : "<p class=\"muted\">No doses scheduled today.</p>"}</article>`).join("") : "<p>No medications yet. Add one above to begin tracking.</p>"}</section>
      <section class="card"><h2>Upcoming doses</h2>${analytics.upcoming_doses.length ? `<ul>${analytics.upcoming_doses.map((dose) => `<li>${escapeHtml(medicationLabel(dose))} — ${escapeHtml(displayDateTime(dose.scheduled_at))}</li>`).join("")}</ul>` : "<p>No upcoming doses in the current schedule window.</p>"}</section>
      <section class="card"><h2>Recent missed doses</h2>${analytics.recent_missed_doses.length ? `<ul>${analytics.recent_missed_doses.map((dose) => `<li>${escapeHtml(medicationLabel(dose))} — ${escapeHtml(displayDateTime(dose.scheduled_at))}</li>`).join("")}</ul>` : "<p>No missed doses recorded.</p>"}</section>
      ${renderTrackingSections(followUps, medicalTests, followUpFilters, medicalTestFilters, metrics)}`;
    document.querySelector("#logout").onclick = () => { localStorage.removeItem(tokenKey); renderAuth(); };
    document.querySelector("#medication-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const message = document.querySelector("#medication-message");
      const doseTimes = String(form.get("dose_times")).split(",").map((time) => time.trim()).filter(Boolean);
      try {
        await request("/api/medications", { method: "POST", body: JSON.stringify({
          name: form.get("name"), dosage: form.get("dosage") || null, dosage_unit: form.get("dosage_unit") || null,
          dose_times: doseTimes, start_date: form.get("start_date"), end_date: form.get("end_date") || null,
          instructions: form.get("instructions") || null, notes: form.get("notes") || null,
        }) });
        renderMedicationDashboard();
      } catch (error) { message.textContent = error.message; }
    };
    document.querySelectorAll("[data-dose-action]").forEach((button) => button.onclick = async () => {
      try {
        await request(`/api/medications/${button.dataset.medicationId}/${button.dataset.doseAction}`, { method: "POST", body: JSON.stringify({ scheduled_at: button.dataset.scheduledAt }) });
        renderMedicationDashboard();
      } catch (error) { window.alert(error.message); }
    });
    document.querySelector("#followup-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const message = document.querySelector("#followup-message");
      try {
        await request("/api/follow-ups", { method: "POST", body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description") || null,
          provider_or_specialist: form.get("provider_or_specialist") || null,
          appointment_date: form.get("appointment_date") || null,
          appointment_time: form.get("appointment_time") || null,
          due_date: form.get("due_date") || null,
          status: form.get("status"),
        }) });
        renderMedicationDashboard();
      } catch (error) { message.textContent = error.message; }
    };
    document.querySelector("#test-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const message = document.querySelector("#test-message");
      try {
        await request("/api/medical-tests", { method: "POST", body: JSON.stringify({
          test_name: form.get("test_name"),
          instructions: form.get("instructions") || null,
          scheduled_date: form.get("scheduled_date") || null,
          status: form.get("status"),
        }) });
        renderMedicationDashboard();
      } catch (error) { message.textContent = error.message; }
    };
    const trackerAction = async (action, path, confirmText) => {
      if (confirmText && !window.confirm(confirmText)) return;
      try { await request(path, action); renderMedicationDashboard(); }
      catch (error) { window.alert(error.message); }
    };
    document.querySelectorAll("[data-followup-complete]").forEach((button) => button.onclick = () =>
      trackerAction({ method: "POST" }, `/api/follow-ups/${button.dataset.followupComplete}/complete`));
    document.querySelectorAll("[data-followup-status]").forEach((button) => button.onclick = () =>
      trackerAction({ method: "PATCH", body: JSON.stringify({ status: button.dataset.value }) }, `/api/follow-ups/${button.dataset.followupStatus}`));
    document.querySelectorAll("[data-followup-delete]").forEach((button) => button.onclick = () =>
      trackerAction({ method: "DELETE" }, `/api/follow-ups/${button.dataset.followupDelete}`, "Delete this follow-up? This cannot be undone."));
    document.querySelectorAll("[data-test-complete]").forEach((button) => button.onclick = () =>
      trackerAction({ method: "POST", body: "{}" }, `/api/medical-tests/${button.dataset.testComplete}/complete`));
    document.querySelectorAll("[data-test-status]").forEach((button) => button.onclick = () =>
      trackerAction({ method: "PATCH", body: JSON.stringify({ status: button.dataset.value }) }, `/api/medical-tests/${button.dataset.testStatus}`));
    document.querySelectorAll("[data-test-delete]").forEach((button) => button.onclick = () =>
      trackerAction({ method: "DELETE" }, `/api/medical-tests/${button.dataset.testDelete}`, "Delete this medical test? This cannot be undone."));
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
      message.textContent = permission === "granted" ? "Browser notifications enabled while this page is open." : "Browser notification permission was not granted.";
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
    document.querySelectorAll("[data-reminder-snooze]").forEach((button) => button.onclick = () => {
      snoozedUntilByDoseId.set(button.dataset.reminderSnooze, Date.now() + 10 * 60_000);
      document.querySelector("#reminder-message").textContent = "Reminder snoozed for 10 minutes. The dose remains scheduled.";
      renderMedicationDashboard();
    });
    document.querySelectorAll("[data-reminder-taken]").forEach((button) => button.onclick = async () => {
      try {
        await request(`/api/medications/${button.dataset.medicationId}/taken`, { method: "POST", body: JSON.stringify({ scheduled_at: button.dataset.scheduledAt }) });
        snoozedUntilByDoseId.delete(button.dataset.reminderTaken);
        renderMedicationDashboard();
      } catch (error) { window.alert(error.message); }
    });
    const notifyDueDoses = () => {
      if (reminderMuted) return;
      const due = findDueDoses({
        dueDoses: analytics.due_doses || [],
        upcomingDoses: analytics.upcoming_doses || [],
        snoozedUntilById: snoozedUntilByDoseId,
      });
      if ("Notification" in window && Notification.permission === "granted") {
        claimUndeliveredDoses(due, notifiedDoseIds).forEach((dose) => {
          new Notification("CareBridge medication reminder", { body: `${medicationLabel(dose)} is due now.` });
        });
      }
      if (shouldPlayReminderSound(readReminderSoundPreference(window.localStorage), reminderAudioContext?.state === "running")) {
        claimUndeliveredDoses(due, soundedDoseIds).forEach(() => playReminderSound());
      }
    };
    notifyDueDoses();
    medicationReminderTimer = window.setInterval(notifyDueDoses, 60_000);
  } catch (error) {
    main.innerHTML = `<section class="card"><h1>Unable to load medications</h1><p class="message">${escapeHtml(error.message)}</p><button id="retry">Try again</button></section>`;
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
  if (medicationReminderTimer) window.clearInterval(medicationReminderTimer);
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
  document.querySelector("#logout").onclick = () => { localStorage.removeItem(tokenKey); renderAuth(); };
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
