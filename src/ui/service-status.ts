// Client-side reachability checker for LHDN MyInvois environments.
//
// IMPORTANT — what this can and cannot tell you:
// The MyInvois identity host does NOT send `Access-Control-Allow-Origin`
// headers, so a normal (CORS) `fetch` from a browser page cannot read its
// response. We therefore issue a `no-cors` request: the browser will not let
// us read the status/body (the response is "opaque"), but the request still
// either *completes* (the host answered) or *rejects* (DNS failure, connection
// refused, TLS error, timeout).
//
// So this is a REACHABILITY probe, not a true health check:
//   - "reachable"   -> the host answered *something* (it is up and serving TLS)
//   - "unreachable" -> network error / timeout (host down, or the USER's own
//                      network/proxy is blocking it)
//   - "checking"    -> a probe is in flight
//
// It cannot distinguish HTTP 200 from HTTP 500, and a user behind a
// restrictive firewall may see "unreachable" even when MyInvois is fine.
// The UI must label results honestly ("reachable from your browser").

export type ServiceStatus = "reachable" | "unreachable" | "checking" | "unknown";

export interface EndpointConfig {
  /** Stable key used for DOM ids / lookups. */
  id: string;
  /** Human-readable environment name. */
  label: string;
  /** URL to probe. The identity endpoint answers without authentication. */
  url: string;
}

// Official MyInvois environment identity endpoints.
//
// We probe the identity token endpoint (`/connect/token`). It only accepts an
// authenticated POST, so a bare `no-cors` GET comes back HTTP 404 — but a 404
// still proves the host answered (it is up and serving TLS), which is exactly
// the reachability signal we want.
//
// NOTE: the browser logs that 404 as a red `[error]` ("Failed to load
// resource: 404") in the devtools console, and this CANNOT be suppressed from
// JavaScript for a cross-origin `no-cors`/opaque request. We investigated
// probing a path that returns 2xx instead, but every path on these hosts
// (including `/`, `/connect/token`, and `/.well-known/openid-configuration`)
// returns 404 to an unauthenticated GET, so no URL choice avoids the console
// entry. The two 404 lines on load are therefore expected and harmless — they
// are the probe working, not an application error.
export const ENDPOINTS: EndpointConfig[] = [
  {
    id: "prod",
    label: "Production",
    url: "https://api.myinvois.hasil.gov.my/connect/token",
  },
  {
    id: "preprod",
    label: "Pre-production (Sandbox / UAT)",
    url: "https://preprod-api.myinvois.hasil.gov.my/connect/token",
  },
];

export interface PingOptions {
  /** Injectable fetch (defaults to global fetch) — lets tests supply a fake. */
  fetchImpl?: typeof fetch;
  /** Abort the probe after this many ms and treat as unreachable. */
  timeoutMs?: number;
  /** Injectable timer setup (defaults to global setTimeout) — for tests. */
  now?: () => number;
}

export interface PingResult {
  status: ServiceStatus;
  /** Round-trip time in ms (only meaningful for "reachable"). */
  ms: number;
}

/**
 * Probe a single endpoint for reachability.
 *
 * Uses a `no-cors` request so that a cross-origin host that lacks CORS headers
 * (like MyInvois) still counts as "reachable" when it answers. Any thrown
 * error (network failure, timeout via AbortController) is treated as
 * "unreachable".
 */
export async function pingEndpoint(url: string, opts: PingOptions = {}): Promise<PingResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const now = opts.now ?? (() => Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now();

  try {
    // `no-cors` + GET: we cannot read the opaque result, but a resolved promise
    // means the host answered. Cache-busting keeps intermediaries from serving
    // a stale success. HEAD would be ideal but is not universally allowed, and
    // in no-cors mode we cannot inspect the status anyway.
    await fetchImpl(url + (url.includes("?") ? "&" : "?") + "_ts=" + now(), {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return { status: "reachable", ms: now() - started };
  } catch {
    return { status: "unreachable", ms: now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// DOM wiring (browser-only). Kept below the pure logic so the module's core
// stays unit-testable without a DOM.
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<ServiceStatus, string> = {
  reachable: "Host responding",
  unreachable: "No response",
  checking: "Checking\u2026",
  unknown: "Unknown",
};

// Per-status tooltip so the badge itself (not just the footer) explains that
// this is a browser-side reachability probe, not a MyInvois health check.
const STATUS_HINT: Record<ServiceStatus, string> = {
  reachable: "The host answered your browser (it is up and serving TLS). This does not confirm the MyInvois API is healthy.",
  unreachable: "No response — the host may be down, or your own network/proxy may be blocking it.",
  checking: "Probe in flight\u2026",
  unknown: "Not checked yet.",
};

function renderRow(ep: EndpointConfig): string {
  return `
    <span class="status-item" id="status-${ep.id}" title="Reachability of ${ep.label} from your browser">
      <span class="status-dot status-dot-unknown"></span>
      <span class="status-env">${ep.label}</span>
      <span class="status-state" title="${STATUS_HINT.unknown}">${STATUS_TEXT.unknown}</span>
    </span>
  `;
}

function applyStatus(id: string, status: ServiceStatus): void {
  const item = document.getElementById(`status-${id}`);
  if (!item) return;
  const dot = item.querySelector<HTMLElement>(".status-dot");
  const state = item.querySelector<HTMLElement>(".status-state");
  if (dot) dot.className = `status-dot status-dot-${status}`;
  if (state) {
    state.textContent = STATUS_TEXT[status];
    state.title = STATUS_HINT[status];
  }
}

/**
 * Render the status bar into `container` and run an initial check. Returns a
 * `refresh()` function that re-probes all endpoints.
 */
export function initServiceStatus(container: HTMLElement): { refresh: () => Promise<void> } {
  container.innerHTML = `
    <span class="status-label">MyInvois service:</span>
    ${ENDPOINTS.map(renderRow).join("")}
    <button type="button" class="status-refresh" id="status-refresh" title="Re-check now">Refresh</button>
  `;

  const refreshBtn = container.querySelector<HTMLButtonElement>("#status-refresh");

  async function refresh(): Promise<void> {
    if (refreshBtn) refreshBtn.disabled = true;
    ENDPOINTS.forEach((ep) => applyStatus(ep.id, "checking"));
    await Promise.all(
      ENDPOINTS.map(async (ep) => {
        const { status } = await pingEndpoint(ep.url);
        applyStatus(ep.id, status);
      })
    );
    if (refreshBtn) refreshBtn.disabled = false;
  }

  refreshBtn?.addEventListener("click", () => {
    void refresh();
  });

  void refresh();
  return { refresh };
}
