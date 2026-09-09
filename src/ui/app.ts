import { validateDocument } from "../validators/index.js";
import { isValid } from "../types.js";
import type { ValidationIssue } from "../types.js";
import { initServiceStatus } from "./service-status.js";
import { initUatSubmit } from "./submit-uat.js";

const textarea = document.getElementById("doc-input") as HTMLTextAreaElement;
const validateBtn = document.getElementById("validate-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileNameEl = document.getElementById("file-name") as HTMLSpanElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const badgeEl = document.getElementById("result-badge") as HTMLSpanElement;

const statusBarEl = document.getElementById("service-status");
if (statusBarEl) {
  initServiceStatus(statusBarEl);
}

const uatPanelEl = document.getElementById("uat-panel");
if (uatPanelEl) {
  initUatSubmit(uatPanelEl, () => {
    const text = textarea.value;
    const trimmed = text.trim();
    const format = trimmed.startsWith("{") ? "JSON" : trimmed.startsWith("<") ? "XML" : null;
    return { text, format };
  });
}

// Prompt the user once for a piece of their own taxpayer identity and remember
// it in localStorage. Nothing is hard-coded or committed — each user tests with
// their own TIN/NRIC/name. Returns "" if the user cancels.
function getOrAskIdentity(storageKey: string, label: string): string {
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const value = (window.prompt(`Enter ${label}:`) || "").trim();
    if (value) localStorage.setItem(storageKey, value);
    return value;
  } catch {
    return "";
  }
}

const SAMPLE_FILES: Record<string, string> = {
  "valid-json": "samples/valid-invoice.json",
  "invalid-json": "samples/invalid-invoice.json",
  "valid-xml": "samples/valid-invoice.xml",
  "invalid-xml": "samples/invalid-invoice.xml",
  "uat-test": "samples/uat-test-invoice.json",
};

document.querySelectorAll<HTMLButtonElement>("#sample-buttons button[data-sample]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const key = btn.dataset.sample!;
    const url = SAMPLE_FILES[key];
    if (!url) return;
    const res = await fetch(url);
    let text = await res.text();
    // The UAT test invoice carries placeholder tokens so no real taxpayer
    // identity is committed to this public repo. Dates are stamped "now" (LHDN
    // rejects issuance >72h old or in the future). The supplier identity
    // (TIN/NRIC/name) is supplied by the *current user* and kept only in their
    // browser's localStorage — never in the source.
    if (key === "uat-test") {
      const now = new Date(Date.now() - 20 * 60 * 1000);
      const tin = getOrAskIdentity("uat_supplier_tin", "your MyInvois TIN (e.g. IG… for an individual)");
      const nric = getOrAskIdentity("uat_supplier_nric", "your NRIC / registration number");
      const name = getOrAskIdentity("uat_supplier_name", "your registered taxpayer name");
      text = text
        .replace("__ISSUE_DATE__", now.toISOString().slice(0, 10))
        .replace("__ISSUE_TIME__", now.toISOString().slice(11, 19) + "Z")
        .replace("__SUPPLIER_TIN__", tin || "__SUPPLIER_TIN__")
        .replace("__SUPPLIER_NRIC__", nric || "__SUPPLIER_NRIC__")
        .replace("__SUPPLIER_NAME__", name || "__SUPPLIER_NAME__");
    }
    textarea.value = text;
    fileNameEl.textContent = "";
    runValidation();
  });
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  fileNameEl.textContent = file.name;
  textarea.value = await file.text();
  runValidation();
});

["dragover", "dragenter"].forEach((evt) =>
  textarea.addEventListener(evt, (e) => {
    e.preventDefault();
  })
);
textarea.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  fileNameEl.textContent = file.name;
  textarea.value = await file.text();
  runValidation();
});

validateBtn.addEventListener("click", () => runValidation());

function severityRank(sev: ValidationIssue["severity"]): number {
  return sev === "error" ? 0 : 1;
}

function renderIssue(issue: ValidationIssue): string {
  return `
    <div class="issue ${issue.severity}">
      <span class="issue-code">${escapeHtml(issue.code)}</span>
      <div>${escapeHtml(issue.message)}</div>
      ${issue.path ? `<div class="issue-path">${escapeHtml(issue.path)}</div>` : ""}
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function runValidation(): Promise<void> {
  const raw = textarea.value.trim();
  if (!raw) {
    resultsEl.innerHTML = `<p class="empty-state">Paste or load a document, then click Validate.</p>`;
    badgeEl.textContent = "Idle";
    badgeEl.className = "badge badge-idle";
    return;
  }

  badgeEl.textContent = "Validating\u2026";
  badgeEl.className = "badge badge-idle";
  resultsEl.innerHTML = `<p class="empty-state">Validating\u2026</p>`;

  let result;
  try {
    result = await validateDocument(raw);
  } catch (e) {
    resultsEl.innerHTML = `<div class="issue error"><div>Unexpected error while validating: ${escapeHtml(
      (e as Error).message
    )}</div></div>`;
    badgeEl.textContent = "Error";
    badgeEl.className = "badge badge-fail";
    return;
  }

  const pass = isValid(result);
  badgeEl.textContent = pass ? "Pass" : "Fail";
  badgeEl.className = `badge ${pass ? "badge-pass" : "badge-fail"}`;

  const errors = result.issues.filter((i) => i.severity === "error").sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const warnings = result.issues.filter((i) => i.severity === "warning");

  const summary = `
    <div class="summary-line">
      <span>Format: <strong>${result.format.toUpperCase()}</strong></span>
      <span>Document type: <strong>${escapeHtml(result.documentTypeLabel)}</strong></span>
      <span>Errors: <strong>${errors.length}</strong></span>
      <span>Warnings: <strong>${warnings.length}</strong></span>
    </div>
  `;

  const errorHtml = errors.length
    ? `<div class="issue-group"><h3>Errors (${errors.length})</h3>${errors.map(renderIssue).join("")}</div>`
    : "";
  const warningHtml = warnings.length
    ? `<div class="issue-group"><h3>Warnings (${warnings.length})</h3>${warnings.map(renderIssue).join("")}</div>`
    : "";
  const cleanHtml = !errors.length && !warnings.length ? `<p class="empty-state">No issues found.</p>` : "";

  resultsEl.innerHTML = summary + errorHtml + warningHtml + cleanHtml;
}
