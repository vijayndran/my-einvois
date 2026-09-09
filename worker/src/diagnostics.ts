// Decodes LHDN's raw document-details response into a clean, human-readable
// list of diagnostics — the "why was I rejected, and how do I fix it" layer.
//
// This is the core of the paid Diagnose tier: LHDN returns a nested structure of
// validationSteps, each with an optional `error` object that itself may contain
// `innerError[]`. The messages are terse and code-driven (e.g. "ERR236", "CF321").
// We flatten that into a friendly list and attach fix hints for the codes we
// recognise. The hint table is the product moat: it grows with every rejection
// we see.

export type DiagnosticSeverity = "error" | "info";

export interface Diagnostic {
  /** LHDN validation step name, e.g. "Step05-Taxpayer Profile Validator". */
  step?: string;
  /** LHDN error code, e.g. "ERR236", "CF321". */
  code?: string;
  /** LHDN's raw (English) message. */
  message: string;
  /** The document field/path LHDN pointed at, if any. */
  propertyPath?: string;
  /** Our plain-English explanation + how to fix it (if we recognise the code). */
  hint?: string;
  severity: DiagnosticSeverity;
}

export interface DiagnoseResult {
  /** Overall LHDN status: "Valid" | "Invalid" | "Submitted" | ... */
  status: string;
  uuid?: string;
  longId?: string;
  /** True when LHDN accepted the document (Valid). */
  valid: boolean;
  /** Flattened, decoded list of validation findings. Empty when Valid. */
  diagnostics: Diagnostic[];
}

// Known LHDN error/rule codes -> actionable fix hints. Extend freely: this is the
// part that turns a cryptic rejection into a one-line fix.
const FIX_HINTS: Record<string, string> = {
  ERR236:
    "When the buyer is the general public (TIN EI00000000010 with BRN/NRIC = NA), every invoice line's item classification code must be 004. Change ItemClassificationCode to 004.",
  CF321:
    "The document's issue date/time is outside the accepted window. It must be within the last 72 hours and not in the future (UTC). Set IssueDate/IssueTime to a recent UTC timestamp (a few minutes in the past is safest).",
  CF364:
    "The authenticated TIN and the document's supplier TIN do not match. The invoice supplier TIN must equal the TIN tied to your login credentials (or the taxpayer you represent as an intermediary).",
  CF320:
    "A code value is not active or not recognised (e.g. an item/state/classification code). Check it against the current MyInvois code lists.",
  DS302:
    "The digital signature failed validation. For version 1.1 the document must carry a valid XAdES signature; verify the signing certificate and canonicalisation.",
  CF401:
    "A mandatory field is missing or empty. Review the propertyPath and supply the required value.",
};

interface RawError {
  propertyName?: string | null;
  propertyPath?: string | null;
  errorCode?: string | null;
  error?: string | null;
  errorMs?: string | null;
  message?: string | null;
  innerError?: RawError[] | null;
}

interface RawStep {
  name?: string;
  status?: string;
  error?: RawError | null;
}

/** Recursively flatten a RawError (and its innerError chain) into Diagnostics. */
function flattenError(step: string | undefined, e: RawError | null | undefined, out: Diagnostic[]): void {
  if (!e) return;
  const code = e.errorCode ?? undefined;
  const message = e.message ?? e.error ?? "Validation error";
  const propertyPath = e.propertyPath ?? undefined;

  // Only emit a diagnostic for leaf-ish errors that carry a real message/code.
  // Wrapper errors (e.g. "Step05-Invalid Taxpayer Profile Validator") that just
  // contain innerError are skipped in favour of their more specific children.
  const hasInner = Array.isArray(e.innerError) && e.innerError.length > 0;
  if (!hasInner) {
    out.push({
      step,
      code,
      message,
      propertyPath,
      hint: code ? FIX_HINTS[code] : undefined,
      severity: "error",
    });
  }
  if (hasInner) {
    for (const inner of e.innerError!) flattenError(step, inner, out);
  }
}

/**
 * Decode a `DocumentDetails` object (from Get Document Details) into a clean
 * DiagnoseResult. Tolerant of shape variations across LHDN environments.
 */
export function decodeDocumentDetails(details: unknown): DiagnoseResult {
  const d = (details ?? {}) as {
    uuid?: string;
    longId?: string;
    status?: string;
    validationResults?: { status?: string; validationSteps?: RawStep[] };
  };

  const status = d.validationResults?.status ?? d.status ?? "Unknown";
  const valid = status.toLowerCase() === "valid";
  const steps = d.validationResults?.validationSteps ?? [];

  const diagnostics: Diagnostic[] = [];
  for (const s of steps) {
    if (s.status && s.status.toLowerCase() === "valid") continue; // passed steps
    flattenError(s.name, s.error, diagnostics);
  }

  return {
    status,
    uuid: d.uuid,
    longId: d.longId || undefined,
    valid,
    diagnostics,
  };
}
