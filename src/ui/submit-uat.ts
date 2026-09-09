// "Submit to LHDN UAT" panel — calls the Cloudflare Worker proxy (which holds
// the credentials and talks to LHDN server-to-server). This is optional UI:
// it only appears wired up when a proxy URL is configured below.
//
// The proxy endpoint. Point this at your deployed Worker.
const PROXY_URL = "https://myinvois-uat-proxy.vijayndran.workers.dev";

interface SubmitResponse {
  submission?: {
    submissionUid: string | null;
    acceptedDocuments: { uuid: string; invoiceCodeNumber: string }[];
    rejectedDocuments: { invoiceCodeNumber: string; error: unknown }[];
  };
  status?: {
    submissionUid: string;
    overallStatus: string;
    documentSummary?: { uuid: string; status: string; longId?: string }[];
  };
  signed?: boolean;
  error?: string;
  details?: unknown;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Wire the submit panel. `getDocument` returns the current document text and
 * detected format from the main validator UI.
 */
export function initUatSubmit(
  panel: HTMLElement,
  getDocument: () => { text: string; format: "JSON" | "XML" | null }
): void {
  panel.innerHTML = `
    <div class="uat-row">
      <button type="button" id="uat-submit-btn" class="primary-btn">Submit to UAT</button>
      <label class="uat-poll"><input type="checkbox" id="uat-poll" checked /> Poll for result</label>
      <span class="uat-hint">Sends the document above to LHDN's sandbox via the proxy.</span>
    </div>
    <div id="uat-result" class="uat-result"></div>
  `;

  const btn = panel.querySelector<HTMLButtonElement>("#uat-submit-btn")!;
  const pollCb = panel.querySelector<HTMLInputElement>("#uat-poll")!;
  const out = panel.querySelector<HTMLDivElement>("#uat-result")!;

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
    out.innerHTML = `<p class="uat-pending">Submitting to LHDN UAT&hellip;</p>`;

    try {
      const res = await fetch(`${PROXY_URL}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: text, format, codeNumber: "WEB-" + Date.now(), poll: pollCb.checked }),
      });
      const data = (await res.json()) as SubmitResponse;
      out.innerHTML = render(res.status, data);
    } catch (e) {
      out.innerHTML = `<p class="uat-error">Request failed: ${esc(String(e))}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

function render(httpStatus: number, data: SubmitResponse): string {
  if (data.error) {
    return `
      <div class="uat-card uat-card-err">
        <div class="uat-line"><span>Result</span><strong>Error (HTTP ${httpStatus})</strong></div>
        <div class="uat-msg">${esc(data.error)}</div>
        ${data.details ? `<pre class="uat-pre">${esc(JSON.stringify(data.details, null, 2))}</pre>` : ""}
      </div>`;
  }

  const sub = data.submission;
  const accepted = sub?.acceptedDocuments?.[0];
  const rejected = sub?.rejectedDocuments?.[0];
  const overall = data.status?.overallStatus;
  const summary = data.status?.documentSummary?.[0];

  const statusClass =
    overall?.toLowerCase() === "valid" ? "ok" : overall?.toLowerCase() === "invalid" ? "err" : "pending";

  return `
    <div class="uat-card uat-card-${statusClass}">
      <div class="uat-line"><span>Submission UID</span><strong>${esc(sub?.submissionUid ?? "—")}</strong></div>
      <div class="uat-line"><span>Document UUID</span><strong>${esc(accepted?.uuid ?? summary?.uuid ?? "—")}</strong></div>
      <div class="uat-line"><span>Overall status</span><strong>${esc(overall ?? (accepted ? "Accepted (not polled)" : "—"))}</strong></div>
      <div class="uat-line"><span>Signed document</span><strong>${data.signed ? "Yes" : "No"}</strong></div>
      ${
        rejected
          ? `<div class="uat-msg">Rejected: <code>${esc(String((rejected.error as { message?: string })?.message ?? "see details"))}</code></div>`
          : ""
      }
      ${
        data.status
          ? `<pre class="uat-pre">${esc(JSON.stringify(data.status, null, 2))}</pre>`
          : ""
      }
    </div>`;
}
