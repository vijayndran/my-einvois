/**
 * Format-agnostic representation of a MyInvois document.
 *
 * Both the JSON parser (UBL 2.1 JSON Alternative Representation) and the
 * XML parser (UBL 2.1 XML) reduce their source document down to this shape
 * before any business-rule validation runs. This keeps every rule in
 * src/validators/*.ts independent of which wire format was submitted --
 * exactly mirroring how LHDN's own "Structure Validator" and
 * "Core Fields Validator" are described as separate concerns in the SDK
 * (see https://sdk.myinvois.hasil.gov.my/document-validation-rules/).
 */

export type Severity = "error" | "warning";

export interface ValidationIssue {
  /** Short machine-friendly code, e.g. "CF-TIN-FORMAT" */
  code: string;
  severity: Severity;
  /** Human-readable explanation */
  message: string;
  /** Dotted path into the document, for display only, e.g. "Supplier.TIN" */
  path?: string;
}

export interface PartyIdentification {
  tin?: string;
  /** BRN / NRIC / Passport / Army -- whichever scheme was supplied */
  registrationNumber?: string;
  registrationScheme?: "BRN" | "NRIC" | "PASSPORT" | "ARMY";
  sstRegistrationNumber?: string;
  tourismTaxRegistrationNumber?: string;
}

export interface Address {
  addressLines: string[];
  cityName?: string;
  postalZone?: string;
  state?: string; // CountrySubentityCode
  countryCode?: string; // ISO3166-1 alpha-3
}

export interface Party extends PartyIdentification {
  name?: string;
  address?: Address;
  phone?: string;
  email?: string;
  /** Supplier only */
  msicCode?: string;
  msicDescription?: string;
}

export interface TaxSubtotal {
  taxableAmount?: number;
  taxAmount?: number;
  taxCategoryId?: string; // tax type code, or 'E' for exempt
  taxExemptionReason?: string;
  percent?: number;
}

export interface InvoiceLine {
  id?: string;
  description?: string;
  classificationCodes: string[];
  quantity?: number;
  unitCode?: string;
  unitPrice?: number;
  lineExtensionAmount?: number;
  subtotal?: number; // ItemPriceExtension
  taxSubtotals: TaxSubtotal[];
  lineTaxAmount?: number;
  countryOfOrigin?: string;
}

export interface SignatureStructure {
  /** The simple placeholder cac:Signature / Signature element under the document root */
  placeholderPresent: boolean;
  /** The full UBLExtensions -> XAdES enveloped signature block */
  extensionPresent: boolean;
  hasExtensionUri: boolean;
  hasSignatureValue: boolean;
  hasX509Certificate: boolean;
  hasSigningTime: boolean;
  hasCertDigest: boolean;
  hasIssuerSerial: boolean;
  canonicalizationOk: boolean;
  signatureMethodOk: boolean;
  digestMethodOk: boolean;
}

export interface NormalizedInvoice {
  /** "01".."04" or "11".."14" */
  typeCode?: string;
  /** "1.0" or "1.1" */
  versionId?: string;
  id?: string;
  issueDate?: string;
  issueTime?: string;
  currencyCode?: string;
  taxCurrencyCode?: string;
  exchangeRate?: number;

  supplier: Party;
  buyer: Party;

  lines: InvoiceLine[];

  totalExcludingTax?: number;
  totalIncludingTax?: number;
  totalPayable?: number;
  totalNetAmount?: number;
  totalDiscount?: number;
  totalCharge?: number;
  totalTaxAmount?: number;
  roundingAmount?: number;

  /** Credit/Debit/Refund note only */
  originalInvoiceRef?: string;

  paymentMeansCode?: string;

  signature: SignatureStructure;
}

export interface ValidationResult {
  format: "json" | "xml";
  documentTypeLabel: string;
  issues: ValidationIssue[];
  normalized: NormalizedInvoice;
}

export function isValid(result: ValidationResult): boolean {
  return !result.issues.some((i) => i.severity === "error");
}
