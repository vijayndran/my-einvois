// Document preparation + signing helpers for MyInvois submission.
//
// IMPORTANT — the state of signing in this proxy:
//
// MyInvois requires each submitted document to carry an *enveloped XAdES
// digital signature* inside the UBL `UBLExtensions` -> `SignatureInformation`
// block, plus a `cac:Signature` reference. Producing that correctly is a
// multi-step cryptographic process:
//
//   1. Canonicalise the document (C14N) excluding the signature elements.
//   2. SHA-256 digest the canonical form -> the "DocDigest".
//   3. Build the XAdES `SignedProperties` (signing time, cert digest,
//      issuer/serial) and digest THAT too.
//   4. RSA-SHA256 sign the `SignedInfo` (which references both digests).
//   5. Splice the resulting `ds:Signature` back into `UBLExtensions`.
//
// Steps 1 and 5 (XML canonicalisation + precise enveloping in LHDN's expected
// shape) are the genuinely hard part and are NOT implemented here — they need a
// real C14N implementation and byte-exact element ordering. This module gives
// you:
//   * a WORKING hash + base64 + RSA-sign primitive set (WebCrypto), and
//   * `prepareForSubmission()` which assembles the submission document object
//     from an ALREADY-SIGNED document string.
//
// So the pipeline is real end-to-end EXCEPT you must feed it a document that is
// already XAdES-signed (e.g. signed by your ERP, or by LHDN's own signing
// tooling, or a dedicated signing library). This is called out honestly rather
// than pretending to sign.

import { sha256Hex, toBase64, type SubmissionDocument } from "./lhdn-client.js";

export interface SigningMaterial {
  /** X.509 certificate in PEM. In UAT a self-signed test cert is acceptable. */
  certPem: string;
  /** Private key in PKCS#8 PEM. */
  keyPem: string;
}

/**
 * Assemble a SubmissionDocument from an already-signed document string.
 * Computes the SHA-256 hash over the raw document and base64-encodes it, which
 * is exactly what the Submit Documents API expects.
 */
export async function prepareForSubmission(
  signedDocument: string,
  format: "JSON" | "XML",
  codeNumber: string
): Promise<SubmissionDocument> {
  const documentHash = await sha256Hex(signedDocument);
  return {
    format,
    document: toBase64(signedDocument),
    documentHash,
    codeNumber,
  };
}

/**
 * Detect whether a document already carries a signature block. This is a
 * lightweight structural check (mirrors the front-end validator's approach),
 * used to fail fast before submission rather than after a rejected 400.
 */
export function looksSigned(document: string, format: "JSON" | "XML"): boolean {
  if (format === "XML") {
    return /<ds:Signature[\s>]/.test(document) && /UBLExtension/.test(document);
  }
  // JSON UBL: signature lives under UBLExtensions -> ... -> ds:Signature.
  return document.includes("UBLExtensions") && document.includes("ds:Signature");
}

// --------------------- low-level crypto primitives -------------------------
// These work in the Worker runtime (WebCrypto). They are the building blocks a
// full XAdES signer would use for steps 2-4 above.

/** Strip PEM armor and decode base64 to an ArrayBuffer. */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Import a PKCS#8 RSA private key for RSASSA-PKCS1-v1_5 / SHA-256 signing. */
export async function importPrivateKey(keyPem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(keyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/** RSA-SHA256 sign arbitrary bytes; returns base64 signature. */
export async function rsaSignBase64(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(data)
  );
  let binary = "";
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b);
  return btoa(binary);
}
