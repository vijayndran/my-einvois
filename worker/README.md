# MyInvois UAT Submission Proxy (Cloudflare Worker)

A small server-side proxy that does what the browser **cannot**: log in to
LHDN MyInvois, submit a signed e-Invoice, and poll for the validation result and
the assigned **UUID**.

## Why a proxy is required

The main app in this repo is a purely client-side validator. It **cannot**
submit to MyInvois directly, for two hard reasons (verified against the live
API):

1. **CORS** — MyInvois' API (both production *and* the UAT/sandbox host
   `preprod-api.myinvois.hasil.gov.my`) sends no `Access-Control-Allow-Origin`
   header, so a browser `fetch` can't read its responses.
2. **Secrets + signing** — submission needs an OAuth `client_secret` and a
   digitally-signed document. Neither can live safely in browser JavaScript.

This Worker runs server-to-server (no CORS), holds the credentials as Worker
secrets (never shipped to the browser), and exposes a tiny JSON API your front
end can call.

> **UAT vs prod:** UAT is a faithful mirror of production. It still requires a
> real login (register your ERP in the pre-production MyTax portal) and a
> **signed** document — the only concession is that a **self-signed test
> certificate is acceptable in UAT**.

## What's implemented

| Piece | Status |
| --- | --- |
| OAuth2 `client_credentials` login | ✅ Implemented |
| Submit documents (base64 + SHA-256 + `codeNumber`) | ✅ Implemented |
| Size/batch guards (300 KB/doc, 5 MB/submission, 100 docs) | ✅ Implemented |
| Poll submission status until terminal | ✅ Implemented |
| CORS locked to your Pages origin | ✅ Implemented |
| SHA-256 / base64 / RSA-sign primitives (WebCrypto) | ✅ Implemented |
| **XAdES canonicalisation + signature enveloping** | ⚠️ **Not implemented** |

The one genuinely hard piece left is producing the enveloped XAdES signature in
LHDN's exact expected shape (XML C14N + byte-exact element ordering). This proxy
therefore expects you to submit a document that is **already signed** (by your
ERP, LHDN's signing tooling, or a dedicated XAdES library). `src/signing.ts`
documents this in detail and gives you the crypto building blocks; `looksSigned()`
fails fast on unsigned input rather than getting a generic 400 back.

## Prerequisites

- Node.js 18+ and npm
- A Cloudflare account (free tier is fine — 100k requests/day)
- LHDN UAT credentials: register your ERP system in the **pre-production MyTax
  portal** (`https://preprod-mytax.hasil.gov.my/`) to obtain a `client_id` and
  `client_secret`. (Free, but requires going through LHDN's registration.)
- A signing certificate. For UAT you can generate a self-signed one (below).

## Setup

```bash
cd worker
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test via tsx (mocked fetch, no network)
```

### Generate a self-signed test certificate (UAT only)

Requires OpenSSL on your PATH.

```bash
npm run gen-test-cert
# writes scripts/test-key.pem (PKCS#8) and scripts/test-cert.pem
# both are gitignored — never commit them
```

### Configure environment + secrets

Non-secret vars live in `wrangler.toml` (`MYINVOIS_ENV`, `ALLOWED_ORIGIN`).
Set `ALLOWED_ORIGIN` to your Pages site (default:
`https://vijayndran.github.io`).

Secrets are set with Wrangler (never committed):

```bash
npx wrangler secret put MYINVOIS_CLIENT_ID
npx wrangler secret put MYINVOIS_CLIENT_SECRET
# optional, if acting as an intermediary on behalf of a taxpayer:
npx wrangler secret put MYINVOIS_ONBEHALFOF
```

## Run locally

```bash
npm run dev     # wrangler dev, serves on http://localhost:8787
curl http://localhost:8787/health
# -> {"ok":true,"env":"uat"}
```

## Deploy

```bash
npx wrangler deploy            # deploys using [vars] in wrangler.toml (uat)
# or target a named environment:
npx wrangler deploy --env prod
```

Wrangler prints your Worker URL, e.g.
`https://myinvois-uat-proxy.<subdomain>.workers.dev`.

## HTTP API

### `GET /health`
Returns `{ ok: true, env }`. No secrets, no LHDN call.

### `POST /submit`
```jsonc
{
  "document": "<the FULL, already-XAdES-signed document as a string>",
  "format": "JSON",          // or "XML"
  "codeNumber": "INV-001",   // your internal reference
  "poll": true                // optional: poll until validation is terminal
}
```
Response:
```jsonc
{
  "submission": {
    "submissionUid": "…26 chars…",
    "acceptedDocuments": [{ "uuid": "…26 chars…", "invoiceCodeNumber": "INV-001" }],
    "rejectedDocuments": []
  },
  "status": {                 // present when poll=true
    "submissionUid": "…",
    "overallStatus": "Valid"  // or "Invalid" / "PartiallyValid"
  }
}
```

### `POST /status`
```jsonc
{ "submissionUid": "…26 chars…" }
```
Returns the current submission status.

## Wiring the front end

From your Pages site, point at the deployed Worker:

```js
const PROXY = "https://myinvois-uat-proxy.<subdomain>.workers.dev";

async function submitToUat(signedDocument, format, codeNumber) {
  const res = await fetch(`${PROXY}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document: signedDocument, format, codeNumber, poll: true }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  const { submission, status } = await res.json();
  console.log("UUID:", submission.acceptedDocuments[0]?.uuid);
  console.log("Status:", status?.overallStatus);
  return { submission, status };
}
```

CORS is already handled: the Worker echoes `ALLOWED_ORIGIN`. Make sure that var
matches your site's origin exactly (scheme + host, no trailing slash).

## Security notes

- `client_id`/`client_secret` live **only** as Worker secrets, never in the
  browser bundle or in git.
- CORS is restricted to `ALLOWED_ORIGIN` — not `*`.
- The generated `*.pem` test key/cert are gitignored. Never use a self-signed
  cert against production.
- This proxy is unauthenticated to *your* callers beyond the origin check. If
  you expose it publicly, consider adding a shared token / Cloudflare Access so
  only your app can invoke it.

## Limitations

- No XAdES signing (see table above) — bring an already-signed document.
- Single-document submit path is wired; batching is supported by the client
  (`MyInvoisClient.submit` takes an array) but the HTTP route submits one doc
  for simplicity.
- Token is fetched per request. For higher volume, cache the token for its
  ~60-minute lifetime (KV or module-scope) to respect LHDN's login rate limits.
