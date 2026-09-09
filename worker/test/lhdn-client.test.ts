import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MyInvoisClient,
  LhdnApiError,
  BASE_URLS,
  sha256Hex,
  toBase64,
  base64ByteLength,
} from "../src/lhdn-client.js";

// Minimal Response-like factory so we don't depend on a real server.
function mockResponse(status: number, body: unknown, ok?: boolean): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    text: async () => text,
  } as unknown as Response;
}

/** Build a fake fetch that records calls and returns queued responses by URL matcher. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return handler(u, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("login posts client_credentials and returns the token", async () => {
  const { fn, calls } = fakeFetch((url) => {
    assert.equal(url, `${BASE_URLS.uat.identity}/connect/token`);
    return mockResponse(200, { access_token: "tok-123", token_type: "Bearer", expires_in: 3600 });
  });
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });
  const tok = await client.login({ clientId: "id", clientSecret: "secret" });

  assert.equal(tok.access_token, "tok-123");
  const body = String(calls[0].init?.body);
  assert.match(body, /grant_type=client_credentials/);
  assert.match(body, /client_id=id/);
  assert.match(body, /scope=InvoicingAPI/);
});

test("login throws LhdnApiError on 400 with parsed body", async () => {
  const { fn } = fakeFetch(() => mockResponse(400, { error: "invalid_client" }));
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });
  await assert.rejects(
    () => client.login({ clientId: "x", clientSecret: "y" }),
    (err: unknown) => {
      assert.ok(err instanceof LhdnApiError);
      assert.equal(err.status, 400);
      assert.deepEqual(err.body, { error: "invalid_client" });
      return true;
    }
  );
});

test("submit sends bearer token + documents and returns 202 body with uuid", async () => {
  const { fn, calls } = fakeFetch((url, init) => {
    assert.equal(url, `${BASE_URLS.uat.api}/api/v1.0/documentsubmissions/`);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok-123");
    return mockResponse(202, {
      submissionUid: "SUB123456789012345678901234",
      acceptedDocuments: [{ uuid: "UUID12345678901234567890AB", invoiceCodeNumber: "INV-001" }],
      rejectedDocuments: [],
    });
  });
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });
  const res = await client.submit("tok-123", [
    { format: "JSON", document: toBase64("{}"), documentHash: "abc", codeNumber: "INV-001" },
  ]);

  assert.equal(res.submissionUid, "SUB123456789012345678901234");
  assert.equal(res.acceptedDocuments[0].uuid, "UUID12345678901234567890AB");
  const sentBody = JSON.parse(String(calls[0].init?.body));
  assert.equal(sentBody.documents[0].codeNumber, "INV-001");
});

test("submit rejects an oversized (>300KB) document before calling the API", async () => {
  let called = false;
  const { fn } = fakeFetch(() => {
    called = true;
    return mockResponse(202, {});
  });
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });
  const big = toBase64("x".repeat(300 * 1024 + 1));
  await assert.rejects(
    () => client.submit("tok", [{ format: "JSON", document: big, documentHash: "h", codeNumber: "INV-002" }]),
    (err: unknown) => err instanceof LhdnApiError && err.status === 400
  );
  assert.equal(called, false, "API should not be called when the doc is too large");
});

test("submit rejects a batch larger than 100 documents", async () => {
  const { fn } = fakeFetch(() => mockResponse(202, {}));
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });
  const docs = Array.from({ length: 101 }, (_, i) => ({
    format: "JSON" as const,
    document: toBase64("{}"),
    documentHash: "h",
    codeNumber: `INV-${i}`,
  }));
  await assert.rejects(() => client.submit("tok", docs), (err: unknown) => err instanceof LhdnApiError);
});

test("pollUntilDone stops when status is terminal and returns it", async () => {
  const statuses = ["InProgress", "InProgress", "Valid"];
  let i = 0;
  const { fn } = fakeFetch(() => mockResponse(200, { submissionUid: "S", overallStatus: statuses[i++] }));
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });

  const result = await client.pollUntilDone("tok", "S", {
    attempts: 5,
    delayMs: 0,
    sleep: async () => {},
  });
  assert.equal(result.overallStatus, "Valid");
  assert.equal(i, 3, "should have polled exactly 3 times");
});

test("pollUntilDone gives up after max attempts and returns last status", async () => {
  const { fn } = fakeFetch(() => mockResponse(200, { submissionUid: "S", overallStatus: "InProgress" }));
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });
  const result = await client.pollUntilDone("tok", "S", { attempts: 3, delayMs: 0, sleep: async () => {} });
  assert.equal(result.overallStatus, "InProgress");
});

test("pollUntilDone tolerates an early 404 then returns terminal status", async () => {
  const seq = [
    () => mockResponse(404, { error: { code: "NotFound" } }),
    () => mockResponse(200, { submissionUid: "S", overallStatus: "Valid" }),
  ];
  let i = 0;
  const { fn } = fakeFetch(() => seq[Math.min(i++, seq.length - 1)]());
  const client = new MyInvoisClient({ env: "uat", fetchImpl: fn });
  const result = await client.pollUntilDone("tok", "S", { attempts: 4, delayMs: 0, sleep: async () => {} });
  assert.equal(result.overallStatus, "Valid");
});

test("prod env uses the production base URL", () => {
  assert.equal(BASE_URLS.prod.api, "https://api.myinvois.hasil.gov.my");
  assert.equal(BASE_URLS.uat.api, "https://preprod-api.myinvois.hasil.gov.my");
});

test("sha256Hex produces the known digest of the empty string", async () => {
  const hash = await sha256Hex("");
  assert.equal(hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("base64ByteLength matches the original byte length", () => {
  for (const s of ["", "a", "ab", "abc", "abcd", "hello world"]) {
    assert.equal(base64ByteLength(toBase64(s)), new TextEncoder().encode(s).length, `for "${s}"`);
  }
});
