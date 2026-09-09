import type { ValidationResult } from "../types.js";
import { E_INVOICE_TYPES } from "../data/einvoice-types.js";
import { validateCoreFields } from "./core.js";
import { validateParty } from "./party.js";
import { validateLine } from "./line-items.js";
import { validateMonetary } from "./monetary.js";
import { validateSignature } from "./signature.js";
import { parseJsonInvoice } from "./json-validator.js";
import { parseXmlInvoice } from "./xml-validator.js";
import { err } from "./common.js";

export type { ValidationResult, ValidationIssue, NormalizedInvoice } from "../types.js";
export { isValid } from "../types.js";

function sniffFormat(raw: string): "json" | "xml" | "unknown" {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return "json";
  if (trimmed.startsWith("<")) return "xml";
  return "unknown";
}

export async function validateDocument(raw: string, formatHint?: "json" | "xml"): Promise<ValidationResult> {
  const format = formatHint ?? sniffFormat(raw);

  if (format === "unknown") {
    return {
      format: "json",
      documentTypeLabel: "Unrecognised",
      issues: [err("INPUT-FORMAT-UNKNOWN", "Could not tell whether this document is JSON or XML -- it does not start with \"{\" or \"<\".")],
      normalized: emptyInvoiceForError(),
    };
  }

  let parsed;
  if (format === "json") {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return {
        format: "json",
        documentTypeLabel: "Invalid JSON",
        issues: [err("INPUT-JSON-PARSE", `Document is not valid JSON: ${(e as Error).message}`)],
        normalized: emptyInvoiceForError(),
      };
    }
    parsed = parseJsonInvoice(obj);
  } else {
    parsed = await parseXmlInvoice(raw);
  }

  const { normalized, structuralIssues } = parsed;

  const documentTypeLabel = normalized.typeCode ? E_INVOICE_TYPES[normalized.typeCode] ?? `Unknown (${normalized.typeCode})` : "Unknown";

  const issues = [
    ...structuralIssues,
    ...validateCoreFields(normalized),
    ...validateParty(normalized.supplier, "Supplier", { requireMsic: true, requireContact: true }),
    ...validateParty(normalized.buyer, "Buyer", { requireMsic: false, requireContact: true }),
    ...normalized.lines.flatMap((line, i) => validateLine(line, i)),
    ...validateMonetary(normalized),
    ...validateSignature(normalized.signature),
  ];

  return { format, documentTypeLabel, issues, normalized };
}

function emptyInvoiceForError() {
  return {
    supplier: {},
    buyer: {},
    lines: [],
    signature: {
      placeholderPresent: false,
      extensionPresent: false,
      hasExtensionUri: false,
      hasSignatureValue: false,
      hasX509Certificate: false,
      hasSigningTime: false,
      hasCertDigest: false,
      hasIssuerSerial: false,
      canonicalizationOk: false,
      signatureMethodOk: false,
      digestMethodOk: false,
    },
  };
}
