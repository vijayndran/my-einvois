# MyInvois e-Invoice Validator

[![CI](https://github.com/vijayndran/my-einvois/actions/workflows/ci.yml/badge.svg)](https://github.com/vijayndran/my-einvois/actions/workflows/ci.yml)

A client-side validator for Malaysia's **LHDN MyInvois e-Invoice** documents
(UBL 2.1, both the JSON Alternative Representation and XML). It checks a
pasted or uploaded document against three layers, mirroring how LHDN itself
describes its own document validators:

1. **Structural** &mdash; is this actually shaped like a MyInvois document?
   (correct root element, the UBL-JSON array/`"_"` convention, the right
   mandatory elements present)
2. **Business rules** &mdash; TIN format and prefix rules, MSIC code format,
   classification/tax/payment/state code membership, SST registration
   number shape, monetary totals reconciliation
3. **Digital signature structure** &mdash; presence and shape of the
   enveloped XAdES signature block LHDN requires (`UBLExtensions` ->
   `XAdES` -> `ds:Signature`), *not* cryptographic verification (see
   [Limitations](#limitations) below)

Everything runs in the browser. Nothing you paste or upload is sent
anywhere.

## Why

Built as a focused, open-source demonstration of Malaysia e-Invoice /
MyInvois integration depth &mdash; LHDN's JSON and XML document shapes,
TIN and code-list rules, and the XAdES signature structure it requires for
document submission.

## What this is *not*

- **Not affiliated with, endorsed by, or connected to LHDN or MyInvois** in
  any way. It's an independent, unofficial tool built from LHDN's publicly
  published SDK documentation.
- **Not a substitute for submitting to the real MyInvois API/portal.** Only
  LHDN's own validation endpoint can authoritatively accept or reject a
  document.
- **Not a cryptographic signature verifier.** It checks that the XAdES
  signature block is present and shaped correctly (right elements, right
  algorithm identifiers), not that the signature is a valid RSA signature
  from a trusted Malaysian CA over the correctly canonicalised document.
  That requires the actual certificate chain, a Malaysian CA trust store,
  and re-implementing LHDN's canonicalisation + hashing pipeline &mdash;
  out of scope for a client-side tool.
- **Not a reproduction of LHDN's "Mathematical Mappings" ruleset.** The
  monetary cross-checks here (line sums vs. document totals, tax math) are
  a sanity check with a small rounding tolerance, not the authoritative
  calculation rules published at
  [sdk.myinvois.hasil.gov.my/mathematical-mappings](https://sdk.myinvois.hasil.gov.my/mathematical-mappings/).

## Limitations

- Covers Invoice / Credit Note / Debit Note / Refund Note and their
  self-billed variants (document type codes `01`&ndash;`04`, `11`&ndash;`14`), versions
  1.0 and 1.1.
- MSIC codes are checked for **format** (5 digits) only &mdash; the full
  MSIC code list runs to thousands of entries and isn't embedded here. See
  [sdk.myinvois.hasil.gov.my/codes/msic-codes](https://sdk.myinvois.hasil.gov.my/codes/msic-codes/)
  for the authoritative list.
- TIN validation checks format/prefix/length, not whether the TIN is
  actually registered and active with LHDN (that needs the live
  [Validate Taxpayer's TIN API](https://sdk.myinvois.hasil.gov.my/)).
- XML/JSON element matching is done by literal tag name (`cac:`, `cbc:`,
  `ds:`, `xades:`, etc., exactly as LHDN's own samples use them) rather than
  full namespace-URI resolution. This matches every real MyInvois document
  in practice but isn't a fully general UBL processor.

## Architecture

```
src/
  types.ts              Format-agnostic "NormalizedInvoice" shape
  data/                 Reference tables sourced from the MyInvois SDK
                         (e-Invoice types, classification/tax/payment/state
                         codes, general TINs, ISO 4217 / 3166-1 lists)
  validators/
    json-validator.ts   Parses UBL-JSON -> NormalizedInvoice
    xml-validator.ts    Parses UBL-XML  -> NormalizedInvoice
    core.ts             Document-level mandatory fields
    party.ts            Supplier/Buyer rules (TIN, MSIC, address, contact)
    tin.ts               TIN prefix/format rules
    line-items.ts        Invoice line rules
    monetary.ts           Totals reconciliation (sanity check)
    signature.ts           XAdES signature *structure* check
    index.ts                Orchestrator: sniffs format, runs everything
  ui/app.ts               Vanilla DOM wiring for the browser page
```

Both parsers reduce their source format down to the same
`NormalizedInvoice` shape before any business-rule validator runs, so every
rule in `src/validators/*.ts` (other than the two parsers themselves) is
completely format-agnostic.

No UI framework &mdash; plain TypeScript + [esbuild](https://esbuild.github.io/),
bundled to a single small JS file. The only runtime dependency is
[`@xmldom/xmldom`](https://github.com/xmldom/xmldom), used solely as a
Node.js fallback for the test suite; the browser bundle uses the native
`DOMParser` and never pulls xmldom in (it's marked `external` in
`build.mjs`).

## Getting started

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node's built-in test runner, via tsx
npm run dev          # esbuild --watch --serve, http://localhost:8080
npm run build         # production build -> dist/
```

Try it with the bundled samples in `samples/` &mdash; two hand-built
documents (one clean, one deliberately broken) in each of JSON and XML, or
use the "Load sample" buttons in the UI itself.

## Deploying to Cloudflare Pages

1. Push this repo to GitHub (see below if you haven't yet).
2. In the Cloudflare dashboard: **Workers & Pages -> Create -> Pages ->
   Connect to Git**, and select this repository.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Deploy. Cloudflare will rebuild on every push to `main`.

If you'd rather deploy from the CLI: `npx wrangler pages deploy dist`
(after running `npm run build` locally) works too, once you've created the
Pages project.

## Pushing this repo to GitHub

```bash
cd myinvois-einvoice-validator
git init
git add .
git commit -m "Initial commit: MyInvois e-Invoice validator"
git branch -M main
git remote add origin https://github.com/vijayndran/my-einvois.git
git push -u origin main
```

## Sources

Built directly from LHDN's public MyInvois SDK documentation:

- [sdk.myinvois.hasil.gov.my/documents/invoice-v1-0](https://sdk.myinvois.hasil.gov.my/documents/invoice-v1-0/) &mdash; core/Supplier/Buyer/Address/Invoice Line field tables
- [sdk.myinvois.hasil.gov.my/document-validation-rules](https://sdk.myinvois.hasil.gov.my/document-validation-rules/) &mdash; the eight validator categories this tool's structure mirrors
- [sdk.myinvois.hasil.gov.my/signature](https://sdk.myinvois.hasil.gov.my/signature/) and LHDN's own signed sample files &mdash; XAdES signature structure
- [sdk.myinvois.hasil.gov.my/codes/*](https://sdk.myinvois.hasil.gov.my/codes/) &mdash; e-Invoice types, classification codes, tax types, payment modes, state codes
- [sdk.myinvois.hasil.gov.my/faq](https://sdk.myinvois.hasil.gov.my/faq/) &mdash; TIN prefix list and formatting rules

## License

MIT &copy; Vijayndran Asokan
