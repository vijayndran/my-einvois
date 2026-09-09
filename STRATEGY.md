# MyInvois Validator — Product & Go-To-Market Strategy

> Working notes for turning this open-source validator into a funnel for a paid
> MyInvois compliance tool. Not legal advice; regulatory/entity steps should be
> confirmed with a Malaysian accountant/lawyer and LHDN directly.

## The core insight (the hook)

There is a real, painful gap that this project has already proven:

> **A document can pass structural validation and still be *rejected* by LHDN.**

The free client-side validator checks *shape* (UBL structure, TIN format, code
lists, signature structure). But LHDN's live engine applies **content rules** the
client can't see — and the only way to learn *why* a document was rejected is to
call LHDN's `Get Document Details` API and read the per-rule `validationSteps`.

Real example from this project's own testing (UAT):

- Local validator: **Pass** (0 errors).
- LHDN UAT: **Invalid**, rule `ERR236` — "Where General TIN (010) and ID Type
  BRN/NRIC = NA, applicable for Classification Code 004 only."
- Fix: one field (classification code `022` → `004`) → **Valid**, real UUID issued.

That gap between *"looks valid"* and *"LHDN will actually accept it"* is the pain.
Pain is what people pay to remove.

### One-line positioning

> **Free tells you if it's shaped right. Paid tells you *why LHDN rejected you* —
> and can submit it for you.**

## Free vs Paid feature split

| Capability | Free (client-side, open source) | Paid (server-side service) |
| --- | --- | --- |
| UBL structure check (JSON/XML) | ✅ | ✅ |
| TIN format, code lists, monetary sanity | ✅ | ✅ |
| Signature *structure* check | ✅ | ✅ |
| Runs entirely in browser, nothing uploaded | ✅ | — (server-side by design) |
| **Real LHDN rule-checking (submit + read validationSteps)** | ❌ | ✅ |
| **"Why was I rejected" — plain-English error + fix hints** | ❌ | ✅ |
| **Get a real UUID (managed submission)** | ❌ | ✅ |
| **XAdES signing for v1.1 (the hard part)** | ❌ | ✅ (roadmap) |
| Status polling / document retrieval | ❌ | ✅ |
| Batch submission, audit log, webhooks | ❌ | ✅ |
| Credentials held server-side (never in browser) | — | ✅ |

**Funnel logic:** keep the free validator public and genuinely useful (trust +
SEO + "try before you buy"). Gate the *server-side* value — real rule-checking,
diagnostics, submission, signing — behind the paid tier. The free tool creates
the "it says valid but LHDN rejected me — now what?" moment; the paid tool answers
it.

## Tiers (illustrative — validate pricing with real demand)

1. **Free** — client-side validator. £0. The funnel.
2. **Diagnose** — paste a document, we submit to LHDN (sandbox or the customer's
   prod credentials) and return the exact rejection reasons + fix hints. Priced
   per-check or a low monthly. *Lowest regulatory burden — works with the
   customer's own credentials, no signing, no intermediary status needed.*
3. **Submit / Managed** — full login → (sign) → submit → poll → UUID, with status
   and retrieval. Higher tier. *Needs a registered business; if submitting on
   behalf of others, needs Intermediary status + an org CA certificate.*

Start selling tier 2 first. It's the highest value-to-effort ratio and avoids the
business/CA prerequisites (see below).

## Business / regulatory notes (confirm with a professional)

- **Build & test:** no business needed (done as an individual in sandbox).
- **Charge money:** you'll want a registered entity (SSM sole prop/enterprise, or
  Sdn. Bhd. for liability protection when handling others' tax data).
- **Submit on behalf of others:** MyInvois enforces that the invoice supplier TIN
  matches the authenticated account. Either each customer uses their own
  credentials, **or** you register as an **Intermediary** and customers grant you
  permission (portal "Add Intermediary" flow). Intermediary + org **CA
  certificate** (Malaysian licensed CA, per MCMC list) effectively requires an
  entity.
- **Data protection:** processing customers' financial/PII data → Malaysia **PDPA**
  applies. Another reason to operate under a proper entity with ToS + privacy policy.

**Recommended sequencing:** (1) keep free validator as funnel → (2) build & sell
the *Diagnose* tier while still an individual (customer credentials, no signing) →
(3) only after paying demand, register a business + pursue Intermediary/CA to
offer full managed submission and signing.

---

## Landing page copy (draft)

### Hero

**"Your invoice looks valid. LHDN says otherwise."**

Free structure checkers tell you your e-Invoice is *shaped* right. They can't tell
you the one thing that matters: **will LHDN actually accept it?** We do — and we
tell you exactly what to fix.

> [ Paste your document — see why LHDN would reject it → ]

### Sub-hero / trust line

Built on Malaysia's official MyInvois SDK. The free structural validator is open
source and runs entirely in your browser. The paid diagnostics run your document
through LHDN's real validation engine and translate the cryptic error codes into
plain English.

### Three-up value props

1. **See the real rejection reasons.**
   Not "looks fine" — the actual `validationSteps` from LHDN, decoded. Know that
   it's rule `ERR236` (wrong classification code for a general-public buyer), not
   just "Invalid".

2. **Get the fix, not just the error.**
   Every failure comes with a plain-English explanation and the specific field to
   change. Turn a red "Invalid" into a green UUID.

3. **Skip the integration.**
   Have a document but no ERP integration? We handle login, submission, polling
   and the UUID. (Signing for v1.1 on the roadmap.)

### "How it's different from the free checker"

| | Free structure check | This tool |
| --- | --- | --- |
| Is my document shaped like UBL? | ✅ | ✅ |
| Are my codes/TINs formatted right? | ✅ | ✅ |
| **Will LHDN actually accept it?** | ❓ | ✅ |
| **If not, exactly why — and how to fix?** | ❌ | ✅ |

### Honesty band (keep this — it builds trust in a compliance product)

We're independent and not affiliated with LHDN. We don't guarantee acceptance —
LHDN's engine is the only authority. What we do is surface LHDN's own verdict and
reasons *before* it matters, so you fix issues on your terms.

### CTA

> **Stop guessing why LHDN rejected you.**
> [ Run a diagnostic → ]

---

## Notes / risks

- **Don't overpromise.** In a tax-compliance context, "guaranteed accepted" is a
  legal + reputational risk. Under-promise on the guarantee, over-deliver on the
  diagnostics.
- **The moat is the decode layer.** Mapping LHDN's raw `validationSteps` /
  error codes to friendly, actionable messages is the real product — that
  library grows more valuable with every rejection you see.
- **Signing is the premium wedge.** XAdES v1.1 signing is the hardest, highest-value
  piece. Whoever makes that painless owns the managed-submission market.
