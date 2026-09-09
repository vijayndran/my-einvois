// Source: https://sdk.myinvois.hasil.gov.my/codes/e-invoice-types/
export const E_INVOICE_TYPES: Record<string, string> = {
  "01": "Invoice",
  "02": "Credit Note",
  "03": "Debit Note",
  "04": "Refund Note",
  "11": "Self-billed Invoice",
  "12": "Self-billed Credit Note",
  "13": "Self-billed Debit Note",
  "14": "Self-billed Refund Note",
};

/** Type codes that must carry a reference back to the original invoice */
export const REFERENCING_TYPE_CODES = new Set(["02", "03", "04", "12", "13", "14"]);

export const SELF_BILLED_TYPE_CODES = new Set(["11", "12", "13", "14"]);
