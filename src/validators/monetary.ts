import type { NormalizedInvoice, ValidationIssue } from "../types.js";
import { err, warn, approxEqual, sum } from "./common.js";

/**
 * Reconciles the document-level LegalMonetaryTotal figures against each
 * other and against the sum of line items. This is a *sanity check*, not
 * a reproduction of LHDN's authoritative "Mathematical Mappings" ruleset
 * (https://sdk.myinvois.hasil.gov.my/mathematical-mappings/) -- see the
 * README for that distinction. Amounts are compared with a small
 * tolerance to absorb legitimate rounding.
 */
export function validateMonetary(inv: NormalizedInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (inv.totalExcludingTax === undefined) {
    issues.push(err("MONEY-TOTAL-EXCL-TAX", "Total excluding tax (TaxExclusiveAmount) is mandatory.", "LegalMonetaryTotal"));
  }
  if (inv.totalIncludingTax === undefined) {
    issues.push(err("MONEY-TOTAL-INCL-TAX", "Total including tax (TaxInclusiveAmount) is mandatory.", "LegalMonetaryTotal"));
  }
  if (inv.totalPayable === undefined) {
    issues.push(err("MONEY-TOTAL-PAYABLE", "Total payable amount (PayableAmount) is mandatory.", "LegalMonetaryTotal"));
  }
  if (inv.totalTaxAmount === undefined) {
    issues.push(err("MONEY-TOTAL-TAX", "Total tax amount (TaxTotal.TaxAmount) is mandatory.", "TaxTotal"));
  }

  if (inv.totalExcludingTax !== undefined && inv.totalIncludingTax !== undefined && inv.totalTaxAmount !== undefined) {
    const expected = inv.totalExcludingTax + inv.totalTaxAmount;
    if (!approxEqual(expected, inv.totalIncludingTax)) {
      issues.push(
        warn(
          "MONEY-MATH-INCL-TAX",
          `TaxExclusiveAmount (${inv.totalExcludingTax}) + total tax (${inv.totalTaxAmount}) = ${expected.toFixed(
            2
          )}, which does not match TaxInclusiveAmount (${inv.totalIncludingTax}).`,
          "LegalMonetaryTotal.TaxInclusiveAmount"
        )
      );
    }
  }

  if (inv.totalIncludingTax !== undefined && inv.totalPayable !== undefined) {
    const rounding = inv.roundingAmount ?? 0;
    const expected = inv.totalIncludingTax + rounding;
    if (!approxEqual(expected, inv.totalPayable, 0.05)) {
      issues.push(
        warn(
          "MONEY-MATH-PAYABLE",
          `TaxInclusiveAmount (${inv.totalIncludingTax}) + rounding (${rounding}) = ${expected.toFixed(
            2
          )}, which does not closely match PayableAmount (${inv.totalPayable}). If a prepayment was applied, this may be expected.`,
          "LegalMonetaryTotal.PayableAmount"
        )
      );
    }
  }

  if (inv.lines.length) {
    const lineSum = sum(inv.lines.map((l) => l.lineExtensionAmount));
    if (inv.totalExcludingTax !== undefined && !approxEqual(lineSum, inv.totalExcludingTax, Math.max(0.02, lineSum * 0.01))) {
      issues.push(
        warn(
          "MONEY-MATH-LINE-SUM",
          `Sum of line-level LineExtensionAmount (${lineSum.toFixed(
            2
          )}) does not closely match the document TaxExclusiveAmount (${inv.totalExcludingTax}).`,
          "InvoiceLine[].LineExtensionAmount"
        )
      );
    }

    const lineTaxSum = sum(inv.lines.map((l) => l.lineTaxAmount));
    if (inv.totalTaxAmount !== undefined && !approxEqual(lineTaxSum, inv.totalTaxAmount, Math.max(0.02, lineTaxSum * 0.01))) {
      issues.push(
        warn(
          "MONEY-MATH-LINE-TAX-SUM",
          `Sum of line-level tax amounts (${lineTaxSum.toFixed(2)}) does not closely match the document TaxTotal.TaxAmount (${
            inv.totalTaxAmount
          }).`,
          "InvoiceLine[].TaxTotal"
        )
      );
    }
  }

  return issues;
}
