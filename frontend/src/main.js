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
  if (!token()) return renderAuth();
  if (!documentId()) {
    if (role() === "doctor") return renderClinicianDashboard();
    main.innerHTML = `<section class="card"><h1>Review a document</h1><p>Add a document ID to the URL, for example <code>?document=...</code>.</p><button id="logout">Sign out</button></section>`;
    document.querySelector("#logout").onclick = () => { localStorage.removeItem(tokenKey); renderAuth(); };
    return;
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
      <header class="topbar"><h1>Review extracted information</h1><button id="logout">Sign out</button></header>
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
