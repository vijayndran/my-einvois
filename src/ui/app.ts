import { validateDocument } from "../validators/index.js";
import { isValid } from "../types.js";
import type { ValidationIssue } from "../types.js";

const textarea = document.getElementById("doc-input") as HTMLTextAreaElement;
const validateBtn = document.getElementById("validate-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const fileNameEl = document.getElementById("file-name") as HTMLSpanElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const badgeEl = document.getElementById("result-badge") as HTMLSpanElement;

const SAMPLE_FILES: Record<string, string> = {
  "valid-json": "samples/valid-invoice.json",
  "invalid-json": "samples/invalid-invoice.json",
  "valid-xml": "samples/valid-invoice.xml",
  "invalid-xml": "samples/invalid-invoice.xml",
};

document.querySelectorAll<HTMLButtonElement>("#sample-buttons button[data-sample]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const key = btn.dataset.sample!;
    const url = SAMPLE_FILES[key];
    if (!url) return;
    const res = await fetch(url);
    textarea.value = await res.text();
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
