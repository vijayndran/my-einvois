import type { InvoiceLine, ValidationIssue } from "../types.js";
import { CLASSIFICATION_CODES } from "../data/classification-codes.js";
import { TAX_TYPES } from "../data/codes.js";
import { err, warn, approxEqual } from "./common.js";

export function validateLine(line: InvoiceLine, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (suffix: string) => `InvoiceLine[${index}].${suffix}`;

  if (!line.description || line.description.trim() === "") {
    issues.push(err("LINE-DESC", `Line ${index + 1}: description of product/service is mandatory.`, p("Description")));
  }

  if (!line.classificationCodes.length) {
    issues.push(
      err("LINE-CLASS-MISSING", `Line ${index + 1}: at least one classification code is mandatory.`, p("Classification"))
    );
  } else {
    for (const code of line.classificationCodes) {
      if (!(code in CLASSIFICATION_CODES)) {
        issues.push(
          err(
            "LINE-CLASS-UNKNOWN",
            `Line ${index + 1}: classification code "${code}" is not in LHDN's published classification code list.`,
            p("Classification")
          )
        );
      }
    }
  }

  if (line.unitPrice === undefined) {
    issues.push(err("LINE-PRICE", `Line ${index + 1}: unit price is mandatory.`, p("Price")));
  }

  if (line.lineExtensionAmount === undefined) {
    issues.push(
      err("LINE-EXT-AMOUNT", `Line ${index + 1}: line total excluding tax (LineExtensionAmount) is mandatory.`, p("LineExtensionAmount"))
    );
  }

  if (line.subtotal === undefined) {
    issues.push(err("LINE-SUBTOTAL", `Line ${index + 1}: item subtotal (ItemPriceExtension) is mandatory.`, p("Subtotal")));
  }

  if (!line.taxSubtotals.length) {
    issues.push(err("LINE-TAX-MISSING", `Line ${index + 1}: at least one tax subtotal is mandatory.`, p("TaxTotal")));
  } else {
    for (const [i, ts] of line.taxSubtotals.entries()) {
      const tp = p(`TaxTotal[${i}]`);
      if (!ts.taxCategoryId) {
        issues.push(err("LINE-TAX-TYPE-MISSING", `Line ${index + 1}: tax type is mandatory.`, tp));
      } else if (!(ts.taxCategoryId in TAX_TYPES)) {
        issues.push(
          err("LINE-TAX-TYPE-UNKNOWN", `Line ${index + 1}: tax type "${ts.taxCategoryId}" is not a recognised MyInvois tax type code.`, tp)
        );
      }
      if (ts.taxCategoryId === "E" && !ts.taxExemptionReason) {
        issues.push(err("LINE-TAX-EXEMPT-REASON", `Line ${index + 1}: tax exemption reason is mandatory when tax type is "E".`, tp));
      }
      if (ts.taxAmount === undefined) {
        issues.push(err("LINE-TAX-AMOUNT-MISSING", `Line ${index + 1}: tax amount is mandatory for each tax subtotal.`, tp));
      }
    }
  }

  // Sanity cross-check: quantity * unit price ~= subtotal, when both are present.
  if (line.quantity !== undefined && line.unitPrice !== undefined && line.subtotal !== undefined) {
    const expected = line.quantity * line.unitPrice;
    if (!approxEqual(expected, line.subtotal, Math.max(0.02, Math.abs(line.subtotal) * 0.01))) {
      issues.push(
        warn(
          "LINE-MATH-SUBTOTAL",
          `Line ${index + 1}: quantity (${line.quantity}) x unit price (${line.unitPrice}) = ${expected.toFixed(
            2
          )}, which does not match the reported subtotal (${line.subtotal}). This may be a legitimate discount/charge -- check line-level AllowanceCharge.`,
          p("Subtotal")
        )
      );
    }
  }

  return issues;
}
