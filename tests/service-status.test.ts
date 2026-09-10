import { test } from "node:test";
import assert from "node:assert/strict";
import { pingEndpoint, ENDPOINTS } from "../src/ui/service-status.js";

test("pingEndpoint reports reachable when fetch resolves (opaque response)", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calledUrl = String(url);
    calledInit = init;
    // Simulate a no-cors opaque response: resolves, but body/status unreadable.
    return { type: "opaque", status: 0 } as unknown as Response;
  }) as unknown as typeof fetch;

  const result = await pingEndpoint("https://api.example.com/connect/token", { fetchImpl: fakeFetch });
  assert.equal(result.status, "reachable");
  // Uses no-cors mode so a CORS-less host still counts as reachable.
  assert.equal(calledInit?.mode, "no-cors");
  assert.equal(calledInit?.cache, "no-store");
  // Cache-busting query param is appended.
  assert.match(calledUrl, /_ts=\d+/);
});

test("pingEndpoint reports unreachable when fetch rejects (network error)", async () => {
  const fakeFetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;

  const result = await pingEndpoint("https://down.example.com/connect/token", { fetchImpl: fakeFetch });
  assert.equal(result.status, "unreachable");
});

test("pingEndpoint reports unreachable when the probe is aborted (timeout)", async () => {
  // Fetch that honors the abort signal and rejects like the browser does.
  const fakeFetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }
    })) as unknown as typeof fetch;

  const result = await pingEndpoint("https://slow.example.com/connect/token", {
    fetchImpl: fakeFetch,
    timeoutMs: 10,
  });
  assert.equal(result.status, "unreachable");
});

test("ENDPOINTS include production and the UAT/sandbox (preprod) hosts", () => {
  const byId = new Map(ENDPOINTS.map((e) => [e.id, e]));
  assert.ok(byId.has("prod"), "expected a production endpoint");
  assert.ok(byId.has("preprod"), "expected a preprod/UAT endpoint");
  assert.equal(byId.get("prod")!.url, "https://api.myinvois.hasil.gov.my/.well-known/openid-configuration");
  assert.equal(
    byId.get("preprod")!.url,
    "https://preprod-api.myinvois.hasil.gov.my/.well-known/openid-configuration"
  );
  // UAT users should recognise the sandbox label.
  assert.match(byId.get("preprod")!.label, /UAT|sandbox/i);
});
