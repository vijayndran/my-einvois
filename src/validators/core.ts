import type { NormalizedInvoice, ValidationIssue } from "../types.js";
import { E_INVOICE_TYPES, REFERENCING_TYPE_CODES } from "../data/einvoice-types.js";
import { CURRENCY_CODES } from "../data/currency-codes.js";
import { PAYMENT_METHODS } from "../data/codes.js";
import { err, warn, isValidCalendarDate, DATE_RE, TIME_RE } from "./common.js";

export function validateCoreFields(inv: NormalizedInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!inv.id || inv.id.trim() === "") {
    issues.push(err("CORE-ID", "e-Invoice code / number (document reference) is mandatory.", "ID"));
  } else if (inv.id.length > 50) {
    issues.push(err("CORE-ID-LENGTH", `e-Invoice code "${inv.id}" is ${inv.id.length} characters; the maximum is 50.`, "ID"));
  }

  if (!inv.typeCode) {
    issues.push(err("CORE-TYPECODE", "e-Invoice type code is mandatory.", "InvoiceTypeCode"));
  } else if (!(inv.typeCode in E_INVOICE_TYPES)) {
    issues.push(
      err("CORE-TYPECODE-UNKNOWN", `e-Invoice type code "${inv.typeCode}" is not one of the 8 codes LHDN publishes.`, "InvoiceTypeCode")
    );
  }

  if (!inv.versionId) {
    issues.push(err("CORE-VERSION", "e-Invoice version (listVersionID) is mandatory.", "InvoiceTypeCode@listVersionID"));
  } else if (!["1.0", "1.1"].includes(inv.versionId)) {
    issues.push(
      warn(
        "CORE-VERSION-UNKNOWN",
        `e-Invoice version "${inv.versionId}" is not 1.0 or 1.1 -- this validator was written against those two SDK versions.`,
        "InvoiceTypeCode@listVersionID"
      )
    );
  }

  if (!inv.issueDate) {
    issues.push(err("CORE-ISSUEDATE", "e-Invoice date (IssueDate) is mandatory.", "IssueDate"));
  } else if (!isValidCalendarDate(inv.issueDate)) {
    issues.push(
      err("CORE-ISSUEDATE-FORMAT", `IssueDate "${inv.issueDate}" is not a valid xsd:date (expected YYYY-MM-DD, e.g. 2024-07-23).`, "IssueDate")
    );
  }

  if (!inv.issueTime) {
    issues.push(err("CORE-ISSUETIME", "e-Invoice time (IssueTime) is mandatory.", "IssueTime"));
  } else if (!TIME_RE.test(inv.issueTime)) {
    issues.push(
      err(
        "CORE-ISSUETIME-FORMAT",
        `IssueTime "${inv.issueTime}" is not a valid xsd:time in UTC (expected HH:MM:SSZ, e.g. 15:30:00Z).`,
        "IssueTime"
      )
    );
  }

  if (!inv.currencyCode) {
    issues.push(err("CORE-CURRENCY", "Invoice currency code (DocumentCurrencyCode) is mandatory.", "DocumentCurrencyCode"));
  } else if (!CURRENCY_CODES.has(inv.currencyCode)) {
    issues.push(
      err("CORE-CURRENCY-UNKNOWN", `Currency code "${inv.currencyCode}" is not a recognised ISO 4217 code.`, "DocumentCurrencyCode")
    );
  }

  if (inv.currencyCode && inv.currencyCode !== "MYR") {
    if (inv.exchangeRate === undefined) {
      issues.push(
        err(
          "CORE-FX-RATE-MISSING",
          `Currency exchange rate is mandatory when DocumentCurrencyCode ("${inv.currencyCode}") is not MYR.`,
          "TaxExchangeRate.CalculationRate"
        )
      );
    } else if (inv.exchangeRate <= 0) {
      issues.push(err("CORE-FX-RATE-INVALID", `Currency exchange rate ${inv.exchangeRate} must be greater than 0.`, "TaxExchangeRate.CalculationRate"));
    }
  }

  if (!inv.lines.length) {
    issues.push(err("CORE-LINES-EMPTY", "At least one invoice line item is mandatory.", "InvoiceLine"));
  }

  if (inv.typeCode && REFERENCING_TYPE_CODES.has(inv.typeCode) && !inv.originalInvoiceRef) {
    issues.push(
      err(
        "CORE-REF-MISSING",
        `Document type "${E_INVOICE_TYPES[inv.typeCode]}" must reference the original e-Invoice it adjusts (BillingReference).`,
        "BillingReference"
      )
    );
  }

  if (inv.paymentMeansCode && !(inv.paymentMeansCode in PAYMENT_METHODS)) {
    issues.push(
      warn("CORE-PAYMENT-CODE-UNKNOWN", `Payment mode "${inv.paymentMeansCode}" is not one of the 8 codes LHDN publishes.`, "PaymentMeans")
    );
  }

  return issues;
}
