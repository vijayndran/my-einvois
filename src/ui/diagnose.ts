// "Diagnose against LHDN" — a labelled DEMO of the paid tier. It calls the
// Worker's /diagnose endpoint, which submits the document to LHDN's sandbox,
// waits for the verdict, and returns the decoded per-rule diagnostics with fix
// hints. This is the "why did LHDN reject me, and how do I fix it" experience.
//
// It runs on the author's sandbox identity (server-side), so it's a capability
// demo — not a per-customer service. The paid product would run against each
// customer's own credentials. Labelled clearly in the UI.

const PROXY_URL = "https://myinvois-uat-proxy.vijayndran.workers.dev";

interface Diagnostic {
  step?: string;
  code?: string;
  message: string;
  propertyPath?: string;
  hint?: string;
  severity: string;
}

interface DiagnoseResponse {
  status?: string;
  valid?: boolean;
  uuid?: string;
  submissionUid?: string;
  diagnostics?: Diagnostic[];
  error?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function initDiagnose(
  panel: HTMLElement,
  getDocument: () => { text: string; format: "JSON" | "XML" | null }
): void {
  panel.innerHTML = `
    <details class="dg-note uat-note-paid">
      <summary><strong>Paid-tier preview</strong> &mdash; runs your document through LHDN's real engine and decodes the rejection into a plain-English fix.</summary>
      <p>
        This demo uses a shared sandbox identity, so it's a capability preview.
        The paid product runs against <strong>your own</strong> LHDN credentials
        and documents.
      </p>
    </details>
    <div class="uat-row">
      <button type="button" id="diagnose-btn" class="primary-btn">Diagnose against LHDN</button>
      <span class="uat-hint">Tip: load &ldquo;My UAT test invoice&rdquo;, then break a field (e.g. set the item classification code to 022) to see a decoded rejection.</span>
    </div>
    <div id="diagnose-result" class="uat-result"></div>
  `;

  const btn = panel.querySelector<HTMLButtonElement>("#diagnose-btn")!;
  const out = panel.querySelector<HTMLDivElement>("#diagnose-result")!;

  btn.addEventListener("click", async () => {
    const { text, format } = getDocument();
    if (!text.trim()) {
      out.innerHTML = `<p class="uat-error">Load or paste a document above first.</p>`;
      return;
    }
    if (format !== "JSON" && format !== "XML") {
      out.innerHTML = `<p class="uat-error">Could not detect JSON/XML format of the document.</p>`;
      return;
    }

    btn.disabled = true;
    out.innerHTML = `<p class="uat-pending">Diagnosing against LHDN&hellip;</p>`;

    try {
      const res = await fetch(`${PROXY_URL}/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: text, format, codeNumber: "WEB-DIAG-" + Date.now() }),
      });
      const data = (await res.json()) as DiagnoseResponse;
      out.innerHTML = render(res.status, data);
    } catch (e) {
      out.innerHTML = `<p class="uat-error">Request failed: ${esc(String(e))}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

function render(httpStatus: number, data: DiagnoseResponse): string {
  if (data.error) {
    return `<div class="uat-card uat-card-err"><div class="uat-msg">${esc(data.error)}</div></div>`;
  }

  const valid = data.valid === true;
  const statusClass = valid ? "ok" : "err";
  const diags = data.diagnostics ?? [];

  const header = `
    <div class="uat-line"><span>LHDN verdict</span><strong>${esc(data.status ?? "—")}</strong></div>
    <div class="uat-line"><span>Document UUID</span><strong>${esc(data.uuid ?? "—")}</strong></div>
  `;

  if (valid) {
    return `
      <div class="uat-card uat-card-ok">
        ${header}
        <div class="uat-msg">✅ LHDN accepted this document — no issues to fix.</div>
      </div>`;
  }

  const cards = diags
    .map(
      (d) => `
      <div class="dg-item">
        <div class="dg-item-head">
          ${d.code ? `<span class="dg-code">${esc(d.code)}</span>` : ""}
          ${d.step ? `<span class="dg-step">${esc(d.step)}</span>` : ""}
        </div>
        <div class="dg-msg">${esc(d.message)}</div>
        ${d.propertyPath ? `<div class="dg-path">${esc(d.propertyPath)}</div>` : ""}
        ${d.hint ? `<div class="dg-hint"><strong>Fix:</strong> ${esc(d.hint)}</div>` : ""}
      </div>`
    )
    .join("");

  return `
    <div class="uat-card uat-card-${statusClass}">
      ${header}
      <div class="dg-list">
        ${cards || '<div class="uat-msg">Rejected, but LHDN returned no per-rule detail.</div>'}
      </div>
    </div>`;
}
