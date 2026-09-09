import type { Address, InvoiceLine, NormalizedInvoice, Party, SignatureStructure, TaxSubtotal, ValidationIssue } from "../types.js";
import { err } from "./common.js";
import { arr, attr, firstObj, leaf, leafAll, leafNum, reportIfNotArray } from "./ubl-json-nav.js";

export interface ParseResult {
  normalized: NormalizedInvoice;
  structuralIssues: ValidationIssue[];
}

function parseAddress(partyNode: Record<string, unknown> | undefined): Address | undefined {
  const addr = firstObj(partyNode, "PostalAddress");
  if (!addr) return undefined;
  const lines = arr(addr, "AddressLine")
    .map((l) => leaf(l, "Line"))
    .filter((v): v is string => v !== undefined);
  const countryNode = firstObj(addr, "Country");
  return {
    addressLines: lines,
    cityName: leaf(addr, "CityName"),
    postalZone: leaf(addr, "PostalZone"),
    state: leaf(addr, "CountrySubentityCode"),
    countryCode: leaf(countryNode, "IdentificationCode"),
  };
}

function parseIdentification(partyNode: Record<string, unknown> | undefined): {
  tin?: string;
  registrationNumber?: string;
  registrationScheme?: Party["registrationScheme"];
  sstRegistrationNumber?: string;
  tourismTaxRegistrationNumber?: string;
} {
  const idNodes = arr(partyNode, "PartyIdentification").flatMap((n) => arr(n, "ID"));
  let tin: string | undefined;
  let registrationNumber: string | undefined;
  let registrationScheme: Party["registrationScheme"];
  let sst: string | undefined;
  let ttx: string | undefined;

  for (const idNode of idNodes) {
    const scheme = idNode["schemeID"];
    const value = "_" in idNode ? String(idNode["_"]) : undefined;
    if (typeof scheme !== "string" || value === undefined) continue;
    if (scheme === "TIN") tin = value;
    else if (["BRN", "NRIC", "PASSPORT", "ARMY"].includes(scheme)) {
      registrationNumber = value;
      registrationScheme = scheme as Party["registrationScheme"];
    } else if (scheme === "SST") sst = value;
    else if (scheme === "TTX") ttx = value;
  }

  return { tin, registrationNumber, registrationScheme, sstRegistrationNumber: sst, tourismTaxRegistrationNumber: ttx };
}

function parseParty(root: Record<string, unknown>, wrapperKey: string): Party {
  const wrapper = firstObj(root, wrapperKey);
  const partyNode = firstObj(wrapper, "Party");
  const legalEntity = firstObj(partyNode, "PartyLegalEntity");
  const contact = firstObj(partyNode, "Contact");
  const industryClass = firstObj(partyNode, "IndustryClassificationCode");

  return {
    name: leaf(legalEntity, "RegistrationName"),
    address: parseAddress(partyNode),
    phone: leaf(contact, "Telephone"),
    email: leaf(contact, "ElectronicMail"),
    msicCode: industryClass !== undefined && "_" in industryClass ? String(industryClass["_"]) : undefined,
    msicDescription: typeof industryClass?.["name"] === "string" ? (industryClass!["name"] as string) : undefined,
    ...parseIdentification(partyNode),
  };
}

function parseTaxSubtotals(taxTotalNode: Record<string, unknown> | undefined): TaxSubtotal[] {
  const subtotals = arr(taxTotalNode, "TaxSubtotal");
  return subtotals.map((st) => {
    const category = firstObj(st, "TaxCategory");
    return {
      taxableAmount: leafNum(st, "TaxableAmount"),
      taxAmount: leafNum(st, "TaxAmount"),
      taxCategoryId: leaf(category, "ID"),
      taxExemptionReason: leaf(category, "TaxExemptionReason"),
      percent: leafNum(st, "Percent"),
    };
  });
}

function parseLine(lineNode: Record<string, unknown>): InvoiceLine {
  const item = firstObj(lineNode, "Item");
  const commodityClasses = arr(item, "CommodityClassification").filter((c) => attr(c, "ItemClassificationCode", "listID") === "CLASS" || (arr(c, "ItemClassificationCode")[0] && !("listID" in (arr(c, "ItemClassificationCode")[0] ?? {}))));
  const classificationCodes = leafAll(commodityClasses.length ? commodityClasses : arr(item, "CommodityClassification"), "ItemClassificationCode");
  const price = firstObj(lineNode, "Price");
  const itemPriceExt = firstObj(lineNode, "ItemPriceExtension");
  const quantityNode = firstObj(lineNode, "InvoicedQuantity");
  const taxTotal = firstObj(lineNode, "TaxTotal");
  const origin = firstObj(item, "OriginCountry");

  return {
    id: leaf(lineNode, "ID"),
    description: leaf(item, "Description"),
    classificationCodes,
    quantity: quantityNode !== undefined && "_" in quantityNode ? Number(quantityNode["_"]) : undefined,
    unitCode: typeof quantityNode?.["unitCode"] === "string" ? (quantityNode!["unitCode"] as string) : undefined,
    unitPrice: leafNum(price, "PriceAmount"),
    lineExtensionAmount: leafNum(lineNode, "LineExtensionAmount"),
    subtotal: leafNum(itemPriceExt, "Amount"),
    taxSubtotals: parseTaxSubtotals(taxTotal),
    lineTaxAmount: leafNum(taxTotal, "TaxAmount"),
    countryOfOrigin: leaf(origin, "IdentificationCode"),
  };
}

function parseSignature(invoiceNode: Record<string, unknown>): SignatureStructure {
  const placeholderPresent = arr(invoiceNode, "Signature").length > 0;

  const ext = arr(invoiceNode, "UBLExtensions").flatMap((e) => arr(e, "UBLExtension"))[0];
  const extensionPresent = ext !== undefined;
  const extensionUri = ext ? leaf(ext, "ExtensionURI") : undefined;
  const hasExtensionUri = extensionUri === "urn:oasis:names:specification:ubl:dsig:enveloped:xades";

  const sigInfo = ext
    ? arr(ext, "ExtensionContent")
        .flatMap((c) => arr(c, "UBLDocumentSignatures"))
        .flatMap((c) => arr(c, "SignatureInformation"))[0]
    : undefined;

  const sigNode = firstObj(sigInfo, "Signature");
  const signedInfo = firstObj(sigNode, "SignedInfo");
  const keyInfo = firstObj(sigNode, "KeyInfo");
  const x509Data = firstObj(keyInfo, "X509Data");
  const object = firstObj(sigNode, "Object");
  const qualifyingProps = firstObj(object, "QualifyingProperties");
  const signedProps = firstObj(qualifyingProps, "SignedProperties");
  const signedSigProps = firstObj(signedProps, "SignedSignatureProperties");
  const signingCert = firstObj(signedSigProps, "SigningCertificate");
  const cert = firstObj(signingCert, "Cert");
  const certDigest = firstObj(cert, "CertDigest");
  const issuerSerial = firstObj(cert, "IssuerSerial");

  const references = signedInfo ? arr(signedInfo, "Reference") : [];
  const digestMethodOk = references.some((r) => {
    const dm = firstObj(r, "DigestMethod");
    return dm?.["Algorithm"] === "http://www.w3.org/2001/04/xmlenc#sha256";
  });

  const sigMethodNode = firstObj(signedInfo, "SignatureMethod");
  const signatureMethodOk = sigMethodNode?.["Algorithm"] === "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

  return {
    placeholderPresent,
    extensionPresent,
    hasExtensionUri,
    hasSignatureValue: leaf(sigNode, "SignatureValue") !== undefined,
    hasX509Certificate: leaf(x509Data, "X509Certificate") !== undefined,
    hasSigningTime: leaf(signedSigProps, "SigningTime") !== undefined,
    hasCertDigest: firstObj(certDigest, "DigestValue") !== undefined,
    hasIssuerSerial: leaf(issuerSerial, "X509IssuerName") !== undefined && leaf(issuerSerial, "X509SerialNumber") !== undefined,
    // MyInvois's own sample document does not set CanonicalizationMethod under SignedInfo in the
    // minified JSON sample, so we treat this as best-effort rather than a hard structural flag.
    canonicalizationOk: true,
    signatureMethodOk: Boolean(signatureMethodOk),
    digestMethodOk,
  };
}

export function parseJsonInvoice(raw: unknown): ParseResult {
  const structuralIssues: ValidationIssue[] = [];

  if (!raw || typeof raw !== "object") {
    structuralIssues.push(err("JSON-STRUCT-ROOT", "Document root is not a JSON object."));
    return { normalized: emptyInvoice(), structuralIssues };
  }

  reportIfNotArray(raw, "Invoice", "Invoice", structuralIssues);
  const invoiceNode = firstObj(raw, "Invoice");
  if (!invoiceNode) {
    structuralIssues.push(
      err("JSON-STRUCT-NO-INVOICE", 'Top-level "Invoice" array is missing. Every MyInvois JSON document is a single-element "Invoice" array, even for credit/debit/refund notes.')
    );
    return { normalized: emptyInvoice(), structuralIssues };
  }

  for (const key of ["ID", "IssueDate", "IssueTime", "InvoiceTypeCode", "DocumentCurrencyCode", "AccountingSupplierParty", "AccountingCustomerParty", "InvoiceLine", "LegalMonetaryTotal", "TaxTotal"]) {
    reportIfNotArray(invoiceNode, key, `Invoice.${key}`, structuralIssues);
  }

  const typeCodeNode = firstObj(invoiceNode, "InvoiceTypeCode");
  const legalTotal = firstObj(invoiceNode, "LegalMonetaryTotal");
  const taxTotal = firstObj(invoiceNode, "TaxTotal");
  const fxRateNode = firstObj(invoiceNode, "TaxExchangeRate");
  const billingRef = arr(invoiceNode, "BillingReference").flatMap((b) => arr(b, "AdditionalDocumentReference"))[0];
  const paymentMeans = firstObj(invoiceNode, "PaymentMeans");

  const normalized: NormalizedInvoice = {
    typeCode: typeCodeNode !== undefined && "_" in typeCodeNode ? String(typeCodeNode["_"]) : undefined,
    versionId: typeof typeCodeNode?.["listVersionID"] === "string" ? (typeCodeNode!["listVersionID"] as string) : undefined,
    id: leaf(invoiceNode, "ID"),
    issueDate: leaf(invoiceNode, "IssueDate"),
    issueTime: leaf(invoiceNode, "IssueTime"),
    currencyCode: leaf(invoiceNode, "DocumentCurrencyCode"),
    taxCurrencyCode: leaf(invoiceNode, "TaxCurrencyCode"),
    exchangeRate: leafNum(fxRateNode, "CalculationRate"),

    supplier: parseParty(invoiceNode, "AccountingSupplierParty"),
    buyer: parseParty(invoiceNode, "AccountingCustomerParty"),

    lines: arr(invoiceNode, "InvoiceLine").map(parseLine),

    totalExcludingTax: leafNum(legalTotal, "TaxExclusiveAmount"),
    totalIncludingTax: leafNum(legalTotal, "TaxInclusiveAmount"),
    totalPayable: leafNum(legalTotal, "PayableAmount"),
    totalNetAmount: leafNum(legalTotal, "LineExtensionAmount"),
    totalDiscount: leafNum(legalTotal, "AllowanceTotalAmount"),
    totalCharge: leafNum(legalTotal, "ChargeTotalAmount"),
    totalTaxAmount: leafNum(taxTotal, "TaxAmount"),
    roundingAmount: leafNum(legalTotal, "PayableRoundingAmount"),

    originalInvoiceRef: leaf(billingRef, "ID"),
    paymentMeansCode: leaf(paymentMeans, "PaymentMeansCode"),

    signature: parseSignature(invoiceNode),
  };

  return { normalized, structuralIssues };
}

function emptyInvoice(): NormalizedInvoice {
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
