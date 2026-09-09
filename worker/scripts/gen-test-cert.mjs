// Generate a self-signed X.509 test certificate + RSA private key for UAT signing.
//
// UAT/sandbox accepts a self-signed test certificate (production requires a real
// Malaysian CA cert). This script produces:
//   * test-key.pem  — RSA-2048 private key (PKCS#8)
//   * test-cert.pem — self-signed X.509 certificate (valid 1 year)
//
// It shells out to OpenSSL (ubiquitous, and produces standards-clean PEM). Run:
//   node scripts/gen-test-cert.mjs
//
// Then load them as Worker secrets (single line, escaped) or use for local
// signing experiments:
//   npx wrangler secret put SIGNING_KEY_PEM  < test-key.pem
//   npx wrangler secret put SIGNING_CERT_PEM < test-cert.pem
//
// SECURITY: this is a TEST certificate only. Never use it against production,
// and do not commit the generated .pem files (they are gitignored).

import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = dirname(fileURLToPath(import.meta.url));
const keyPath = join(outDir, "test-key.pem");
const certPath = join(outDir, "test-cert.pem");

function haveOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!haveOpenssl()) {
  console.error(
    "OpenSSL not found on PATH. Install it (Windows: `winget install ShiningLight.OpenSSL`,\n" +
      "macOS: `brew install openssl`, Linux: your package manager) and re-run."
  );
  process.exit(1);
}

if (existsSync(keyPath) || existsSync(certPath)) {
  console.error(
    `Refusing to overwrite existing ${keyPath} / ${certPath}. Delete them first if you want fresh ones.`
  );
  process.exit(1);
}

const subject = "/C=MY/ST=Selangor/L=Kuala Lumpur/O=MyInvois UAT Test/CN=myinvois-uat-test";

console.log("Generating RSA-2048 key + self-signed cert (valid 365 days)...");
// -keyout writes a PKCS#8 key by default in modern OpenSSL (3.x); combined with
// -nodes it is unencrypted, which is what WebCrypto importKey("pkcs8") expects.
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "365",
    "-nodes",
    "-subj",
    subject,
  ],
  { stdio: "inherit" }
);

// Normalize to PKCS#8 explicitly (OpenSSL 1.x emits PKCS#1 for -keyout; this is
// a no-op on 3.x but guarantees the format WebCrypto needs on either version).
const tmpPath = keyPath + ".pkcs8";
execFileSync("openssl", ["pkcs8", "-topk8", "-nocrypt", "-in", keyPath, "-out", tmpPath], {
  stdio: "inherit",
});
renameSync(tmpPath, keyPath);

console.log("\nDone:");
console.log("  " + keyPath + "  (private key — keep secret, do not commit)");
console.log("  " + certPath + " (self-signed cert)");
console.log("\nLoad as Worker secrets:");
console.log("  npx wrangler secret put SIGNING_KEY_PEM  < worker/scripts/test-key.pem");
console.log("  npx wrangler secret put SIGNING_CERT_PEM < worker/scripts/test-cert.pem");
