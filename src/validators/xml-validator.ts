import type { Address, InvoiceLine, NormalizedInvoice, Party, SignatureStructure, TaxSubtotal, ValidationIssue } from "../types.js";
import { err } from "./common.js";
import { attrOf, child, children, numOf, text, textOf, type DomLike } from "./ubl-xml-nav.js";
import type { ParseResult } from "./json-validator.js";

/**
 * Resolves a DOMParser implementation for whichever environment this runs
 * in: the browser's native DOMParser, or @xmldom/xmldom under Node (used
 * only by the test suite -- the shipped browser bundle never reaches this
 * branch, see build.mjs which marks @xmldom/xmldom as external).
 */
async function getDomParserCtor(): Promise<new () => { parseFromString(s: string, mime: string): DomLike }> {
  if (typeof (globalThis as Record<string, unknown>)["DOMParser"] === "function") {
    return (globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, mime: string): DomLike } }).DOMParser;
  }
  const mod = await import("@xmldom/xmldom");
  return mod.DOMParser as unknown as new () => { parseFromString(s: string, mime: string): DomLike };
}

function parseAddress(partyEl: DomLike | undefined): Address | undefined {
  const addr = child(partyEl, "cac:PostalAddress");
  if (!addr) return undefined;
  const lines = children(addr, "cac:AddressLine")
    .map((l) => textOf(l, "cbc:Line"))
    .filter((v): v is string => v !== undefined);
  const country = child(addr, "cac:Country");
  return {
    addressLines: lines,
    cityName: textOf(addr, "cbc:CityName"),
    postalZone: textOf(addr, "cbc:PostalZone"),
    state: textOf(addr, "cbc:CountrySubentityCode"),
    countryCode: textOf(country, "cbc:IdentificationCode"),
  };
}

function parseIdentification(partyEl: DomLike | undefined) {
  const idEls = children(partyEl, "cac:PartyIdentification").map((n) => child(n, "cbc:ID")).filter((v): v is DomLike => v !== undefined);
  let tin: string | undefined;
  let registrationNumber: string | undefined;
  let registrationScheme: Party["registrationScheme"];
  let sst: string | undefined;
  let ttx: string | undefined;

  for (const idEl of idEls) {
    const scheme = attrOf(idEl, "schemeID");
    const value = text(idEl);
    if (!scheme || value === undefined) continue;
    if (scheme === "TIN") tin = value;
    else if (["BRN", "NRIC", "PASSPORT", "ARMY"].includes(scheme)) {
      registrationNumber = value;
      registrationScheme = scheme as Party["registrationScheme"];
    } else if (scheme === "SST") sst = value;
    else if (scheme === "TTX") ttx = value;
  }

  return { tin, registrationNumber, registrationScheme, sstRegistrationNumber: sst, tourismTaxRegistrationNumber: ttx };
}

function parseParty(invoiceEl: DomLike, wrapperTag: string): Party {
  const wrapper = child(invoiceEl, wrapperTag);
  const partyEl = child(wrapper, "cac:Party");
  const legalEntity = child(partyEl, "cac:PartyLegalEntity");
  const contact = child(partyEl, "cac:Contact");
  const industryClass = child(partyEl, "cbc:IndustryClassificationCode");

  return {
    name: textOf(legalEntity, "cbc:RegistrationName"),
    address: parseAddress(partyEl),
    phone: textOf(contact, "cbc:Telephone"),
    email: textOf(contact, "cbc:ElectronicMail"),
    msicCode: text(industryClass),
    msicDescription: industryClass ? attrOf(industryClass, "name") : undefined,
    ...parseIdentification(partyEl),
  };
}

function parseTaxSubtotals(taxTotalEl: DomLike | undefined): TaxSubtotal[] {
  return children(taxTotalEl, "cac:TaxSubtotal").map((st) => {
    const category = child(st, "cac:TaxCategory");
    return {
      taxableAmount: numOf(st, "cbc:TaxableAmount"),
      taxAmount: numOf(st, "cbc:TaxAmount"),
      taxCategoryId: textOf(category, "cbc:ID"),
      taxExemptionReason: textOf(category, "cbc:TaxExemptionReason"),
      percent: numOf(st, "cbc:Percent"),
    };
  });
}

function parseLine(lineEl: DomLike): InvoiceLine {
  const item = child(lineEl, "cac:Item");
  const classNodes = children(item, "cac:CommodityClassification")
    .map((c) => ({ el: child(c, "cbc:ItemClassificationCode"), listId: attrOf(child(c, "cbc:ItemClassificationCode"), "listID") }))
    .filter((c) => c.el !== undefined);
  const classificationCodes = classNodes
    .filter((c) => c.listId === "CLASS" || c.listId === undefined)
    .map((c) => text(c.el))
    .filter((v): v is string => v !== undefined);

  const price = child(lineEl, "cac:Price");
  const itemPriceExt = child(lineEl, "cac:ItemPriceExtension");
  const qtyEl = child(lineEl, "cbc:InvoicedQuantity");
  const taxTotal = child(lineEl, "cac:TaxTotal");
  const origin = child(item, "cac:OriginCountry");

  return {
    id: textOf(lineEl, "cbc:ID"),
    description: textOf(item, "cbc:Description"),
    classificationCodes,
    quantity: qtyEl ? Number(text(qtyEl)) : undefined,
    unitCode: qtyEl ? attrOf(qtyEl, "unitCode") : undefined,
    unitPrice: numOf(price, "cbc:PriceAmount"),
    lineExtensionAmount: numOf(lineEl, "cbc:LineExtensionAmount"),
    subtotal: numOf(itemPriceExt, "cbc:Amount"),
    taxSubtotals: parseTaxSubtotals(taxTotal),
    lineTaxAmount: numOf(taxTotal, "cbc:TaxAmount"),
    countryOfOrigin: textOf(origin, "cbc:IdentificationCode"),
  };
}

function parseSignature(invoiceEl: DomLike): SignatureStructure {
  const placeholderPresent = child(invoiceEl, "cac:Signature") !== undefined;

  const ext = children(invoiceEl, "UBLExtensions")
    .flatMap((e) => children(e, "UBLExtension"))[0];
  const extensionPresent = ext !== undefined;
  const extensionUri = textOf(ext, "ExtensionURI");
  const hasExtensionUri = extensionUri === "urn:oasis:names:specification:ubl:dsig:enveloped:xades";

  const sigInfo = ext
    ? children(ext, "ExtensionContent")
        .flatMap((c) => children(c, "sig:UBLDocumentSignatures"))
        .flatMap((c) => children(c, "sac:SignatureInformation"))[0]
    : undefined;

  const sigEl = child(sigInfo, "ds:Signature");
  const signedInfo = child(sigEl, "ds:SignedInfo");
  const keyInfo = child(sigEl, "ds:KeyInfo");
  const x509Data = child(keyInfo, "ds:X509Data");
  const object = child(sigEl, "ds:Object");
  const qualifyingProps = child(object, "xades:QualifyingProperties");
  const signedProps = child(qualifyingProps, "xades:SignedProperties");
  const signedSigProps = child(signedProps, "xades:SignedSignatureProperties");
  const signingCert = child(signedSigProps, "xades:SigningCertificate");
  const cert = child(signingCert, "xades:Cert");
  const certDigest = child(cert, "xades:CertDigest");
  const issuerSerial = child(cert, "xades:IssuerSerial");

  const references = signedInfo ? children(signedInfo, "ds:Reference") : [];
  const digestMethodOk = references.some((r) => {
    const dm = child(r, "ds:DigestMethod");
    return attrOf(dm, "Algorithm") === "http://www.w3.org/2001/04/xmlenc#sha256";
  });

  const canonEl = child(signedInfo, "ds:CanonicalizationMethod");
  const canonAlg = attrOf(canonEl, "Algorithm") ?? "";
  // LHDN's own published guidance and its own working sample disagree on the
  // exact URI (xml-c14n11 vs the exclusive-c14n URN) -- see README. We treat
  // presence of a c14n-family algorithm as sufficient rather than an exact match.
  const canonicalizationOk = canonEl !== undefined && /c14n/i.test(canonAlg);

  const sigMethodEl = child(signedInfo, "ds:SignatureMethod");
  const signatureMethodOk = attrOf(sigMethodEl, "Algorithm") === "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

  return {
    placeholderPresent,
    extensionPresent,
    hasExtensionUri,
    hasSignatureValue: textOf(sigEl, "ds:SignatureValue") !== undefined,
    hasX509Certificate: textOf(x509Data, "ds:X509Certificate") !== undefined,
    hasSigningTime: textOf(signedSigProps, "xades:SigningTime") !== undefined,
    hasCertDigest: child(certDigest, "ds:DigestValue") !== undefined,
    hasIssuerSerial: textOf(issuerSerial, "ds:X509IssuerName") !== undefined && textOf(issuerSerial, "ds:X509SerialNumber") !== undefined,
    canonicalizationOk,
    signatureMethodOk: Boolean(signatureMethodOk),
    digestMethodOk,
  };
}

export async function parseXmlInvoice(xmlText: string): Promise<ParseResult> {
  const structuralIssues: ValidationIssue[] = [];
  const DOMParserCtor = await getDomParserCtor();
  const parser = new DOMParserCtor();
  const doc = parser.parseFromString(xmlText, "text/xml") as unknown as DomLike;

  // Native DOMParser reports errors via a <parsererror> element instead of throwing.
  const asAny = doc as unknown as { getElementsByTagName?: (n: string) => ArrayLike<unknown> };
  if (asAny.getElementsByTagName && asAny.getElementsByTagName("parsererror").length > 0) {
    structuralIssues.push(err("XML-STRUCT-PARSE", "The document is not well-formed XML and could not be parsed."));
    return { normalized: emptyInvoice(), structuralIssues };
  }

  const docEl = (doc as unknown as { documentElement?: DomLike }).documentElement;
  if (!docEl || (docEl.tagName ?? docEl.nodeName) !== "Invoice") {
    structuralIssues.push(
      err(
        "XML-STRUCT-ROOT",
        `Root element should be <Invoice> (MyInvois reuses this root for every document type). Found "${
          docEl ? docEl.tagName ?? docEl.nodeName : "(none)"
        }".`
      )
    );
    return { normalized: emptyInvoice(), structuralIssues };
  }

  for (const tag of ["cbc:ID", "cbc:IssueDate", "cbc:IssueTime", "cbc:InvoiceTypeCode", "cbc:DocumentCurrencyCode", "cac:AccountingSupplierParty", "cac:AccountingCustomerParty", "cac:InvoiceLine", "cac:LegalMonetaryTotal", "cac:TaxTotal"]) {
    if (!child(docEl, tag)) {
      structuralIssues.push(err("XML-STRUCT-MISSING", `Expected element <${tag}> was not found as a direct child of <Invoice>.`, tag));
    }
  }

  const typeCodeEl = child(docEl, "cbc:InvoiceTypeCode");
  const legalTotal = child(docEl, "cac:LegalMonetaryTotal");
  const taxTotal = child(docEl, "cac:TaxTotal");
  const fxRateEl = child(docEl, "cac:TaxExchangeRate");
  const billingRef = child(child(docEl, "cac:BillingReference"), "cac:AdditionalDocumentReference");
  const paymentMeans = child(docEl, "cac:PaymentMeans");

  const normalized: NormalizedInvoice = {
    typeCode: text(typeCodeEl),
    versionId: typeCodeEl ? attrOf(typeCodeEl, "listVersionID") : undefined,
    id: textOf(docEl, "cbc:ID"),
    issueDate: textOf(docEl, "cbc:IssueDate"),
    issueTime: textOf(docEl, "cbc:IssueTime"),
    currencyCode: textOf(docEl, "cbc:DocumentCurrencyCode"),
    taxCurrencyCode: textOf(docEl, "cbc:TaxCurrencyCode"),
    exchangeRate: numOf(fxRateEl, "cbc:CalculationRate"),

    supplier: parseParty(docEl, "cac:AccountingSupplierParty"),
    buyer: parseParty(docEl, "cac:AccountingCustomerParty"),

    lines: children(docEl, "cac:InvoiceLine").map(parseLine),

    totalExcludingTax: numOf(legalTotal, "cbc:TaxExclusiveAmount"),
    totalIncludingTax: numOf(legalTotal, "cbc:TaxInclusiveAmount"),
    totalPayable: numOf(legalTotal, "cbc:PayableAmount"),
    totalNetAmount: numOf(legalTotal, "cbc:LineExtensionAmount"),
    totalDiscount: numOf(legalTotal, "cbc:AllowanceTotalAmount"),
    totalCharge: numOf(legalTotal, "cbc:ChargeTotalAmount"),
    totalTaxAmount: numOf(taxTotal, "cbc:TaxAmount"),
    roundingAmount: numOf(legalTotal, "cbc:PayableRoundingAmount"),

    originalInvoiceRef: textOf(billingRef, "cbc:ID"),
    paymentMeansCode: textOf(paymentMeans, "cbc:PaymentMeansCode"),

    signature: parseSignature(docEl),
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
