import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareForSubmission, looksSigned } from "../src/signing.js";
import { sha256Hex, base64ByteLength } from "../src/lhdn-client.js";

test("prepareForSubmission base64s the doc and hashes the raw content", async () => {
  const doc = '{"Invoice":[{"ID":[{"_":"INV-001"}]}]}';
  const prepared = await prepareForSubmission(doc, "JSON", "INV-001");

  assert.equal(prepared.format, "JSON");
  assert.equal(prepared.codeNumber, "INV-001");
  assert.equal(prepared.documentHash, await sha256Hex(doc));
  // The base64 should round-trip to the same byte length as the source.
  assert.equal(base64ByteLength(prepared.document), new TextEncoder().encode(doc).length);
  assert.equal(Buffer.from(prepared.document, "base64").toString("utf8"), doc);
});

test("looksSigned detects an XAdES block in XML", () => {
  const signedXml =
    '<Invoice><ext:UBLExtensions><ext:UBLExtension><ds:Signature Id="s">...</ds:Signature></ext:UBLExtension></ext:UBLExtensions></Invoice>';
  assert.equal(looksSigned(signedXml, "XML"), true);
});

test("looksSigned rejects unsigned XML", () => {
  assert.equal(looksSigned("<Invoice><cbc:ID>INV-1</cbc:ID></Invoice>", "XML"), false);
});

test("looksSigned detects a signature block in JSON UBL", () => {
  const signedJson = JSON.stringify({
    Invoice: [{ UBLExtensions: [{ UBLExtension: [{ "ds:Signature": [{}] }] }] }],
  });
  assert.equal(looksSigned(signedJson, "JSON"), true);
});

test("looksSigned rejects unsigned JSON", () => {
  const unsigned = JSON.stringify({ Invoice: [{ ID: [{ _: "INV-1" }] }] });
  assert.equal(looksSigned(unsigned, "JSON"), false);
});
