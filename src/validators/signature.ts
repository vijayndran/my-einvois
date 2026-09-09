import type { SignatureStructure, ValidationIssue } from "../types.js";
import { err, warn } from "./common.js";

/**
 * Checks that the document carries the *structure* LHDN requires for its
 * enveloped XAdES signature (see https://sdk.myinvois.hasil.gov.my/signature/).
 *
 * This is a structural presence/shape check only -- it confirms the right
 * elements exist with the right algorithm identifiers. It does NOT verify
 * the cryptographic signature itself (that requires the actual signing
 * certificate chain, a trusted Malaysian CA root store, and canonicalising
 * + re-hashing the document -- work that only LHDN's own validation
 * endpoint can authoritatively perform). Treat a pass here as "shaped
 * correctly for submission", not "cryptographically valid".
 */
export function validateSignature(sig: SignatureStructure, versionId?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // A digital signature is only *validated* for document version 1.1. For
  // version 1.0 LHDN accepts unsigned documents, so a missing signature there
  // is informational (a warning) rather than an error. Anything else (1.1 or an
  // unknown version) keeps the stricter error severity.
  const signatureOptional = versionId === "1.0";
  const missingSig = signatureOptional ? warn : err;
  const optionalNote = signatureOptional
    ? " (Document version 1.0 does not require a signature, so this is informational — LHDN validates signatures only for v1.1.)"
    : "";

  if (!sig.placeholderPresent) {
    issues.push(
      missingSig(
        "SIG-PLACEHOLDER-MISSING",
        "The document-level Signature placeholder element (cac:Signature in XML, or the top-level Signature array in JSON) is missing. This is mandatory on every signature-validated document." +
          optionalNote,
        "Signature"
      )
    );
  }

  if (!sig.extensionPresent) {
    issues.push(
      missingSig(
        "SIG-EXTENSION-MISSING",
        "No UBLExtensions signature block was found. LHDN requires an enveloped XAdES signature under ext:UBLExtensions (XML) or the UBLExtensions array (JSON) for signature-validated document versions (e.g. Invoice v1.1)." +
          optionalNote,
        "UBLExtensions"
      )
    );
    return issues; // nothing further to check without the extension block
  }

  if (!sig.hasExtensionUri) {
    issues.push(
      err(
        "SIG-EXTENSION-URI",
        'ExtensionURI is missing or is not "urn:oasis:names:specification:ubl:dsig:enveloped:xades".',
        "UBLExtensions.UBLExtension.ExtensionURI"
      )
    );
  }

  if (!sig.hasSignatureValue) {
    issues.push(err("SIG-VALUE-MISSING", "SignatureValue is missing from the signature block.", "...Signature.SignatureValue"));
  }

  if (!sig.hasX509Certificate) {
    issues.push(
      err(
        "SIG-CERT-MISSING",
        "X509Certificate is missing from KeyInfo/X509Data. The signing certificate's public data must be embedded in the document.",
        "...Signature.KeyInfo.X509Data.X509Certificate"
      )
    );
  }

  if (!sig.hasSigningTime) {
    issues.push(
      err(
        "SIG-SIGNINGTIME-MISSING",
        "SigningTime is missing from the XAdES SignedSignatureProperties.",
        "...SignedSignatureProperties.SigningTime"
      )
    );
  }

  if (!sig.hasCertDigest) {
    issues.push(
      err(
        "SIG-CERTDIGEST-MISSING",
        "SigningCertificate.Cert.CertDigest (DigestMethod + DigestValue) is missing.",
        "...SigningCertificate.Cert.CertDigest"
      )
    );
  }

  if (!sig.hasIssuerSerial) {
    issues.push(
      err(
        "SIG-ISSUERSERIAL-MISSING",
        "SigningCertificate.Cert.IssuerSerial (X509IssuerName + X509SerialNumber) is missing.",
        "...SigningCertificate.Cert.IssuerSerial"
      )
    );
  }

  if (!sig.canonicalizationOk) {
    issues.push(
      warn(
        "SIG-C14N-METHOD",
        "CanonicalizationMethod was not found or does not reference xml-c14n11, as required by the SDK.",
        "...SignedInfo.CanonicalizationMethod"
      )
    );
  }

  if (!sig.signatureMethodOk) {
    issues.push(
      err(
        "SIG-METHOD",
        "SignatureMethod is missing or is not rsa-sha256 (http://www.w3.org/2001/04/xmldsig-more#rsa-sha256).",
        "...SignedInfo.SignatureMethod"
      )
    );
  }

  if (!sig.digestMethodOk) {
    issues.push(
      err(
        "SIG-DIGEST-METHOD",
        "DigestMethod is missing or is not sha256 (http://www.w3.org/2001/04/xmlenc#sha256).",
        "...SignedInfo.Reference.DigestMethod"
      )
    );
  }

  return issues;
}
