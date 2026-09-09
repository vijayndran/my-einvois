import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDocument } from "../src/validators/index.js";
import { isValid } from "../src/types.js";
import { validateTin } from "../src/validators/tin.js";

async function sample(name: string): Promise<string> {
  return readFile(new URL(`../samples/${name}`, import.meta.url), "utf8");
}

test("valid JSON sample passes with no errors", async () => {
  const raw = await sample("valid-invoice.json");
  const result = await validateDocument(raw);
  const errors = result.issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0, `expected no errors, got:\n${errors.map((e) => `${e.code}: ${e.message}`).join("\n")}`);
  assert.equal(isValid(result), true);
  assert.equal(result.format, "json");
  assert.equal(result.documentTypeLabel, "Invoice");
});

test("invalid JSON sample fails with expected error codes", async () => {
  const raw = await sample("invalid-invoice.json");
  const result = await validateDocument(raw);
  assert.equal(isValid(result), false);
  const codes = new Set(result.issues.map((i) => i.code));
  assert.ok(codes.has("CORE-ISSUEDATE-FORMAT"), "expected bad IssueDate to be flagged");
  assert.ok(codes.has("CORE-ISSUETIME-FORMAT"), "expected bad IssueTime to be flagged");
  assert.ok(codes.has("TIN-LEGACY-PREFIX"), "expected legacy SG TIN prefix to be flagged");
  assert.ok(codes.has("LINE-CLASS-UNKNOWN"), "expected unknown classification code 999 to be flagged");
  assert.ok(codes.has("SUPPLIER-MSIC-FORMAT"), "expected 3-digit MSIC to be flagged");
  assert.ok(codes.has("BUYER-STATE-CODE"), "expected unknown state code 99 to be flagged");
  assert.ok(codes.has("SIG-EXTENSION-MISSING"), "expected missing signature block to be flagged");
});

test("valid XML sample passes with no errors", async () => {
  const raw = await sample("valid-invoice.xml");
  const result = await validateDocument(raw);
  const errors = result.issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0, `expected no errors, got:\n${errors.map((e) => `${e.code}: ${e.message}`).join("\n")}`);
  assert.equal(result.format, "xml");
});

test("invalid XML sample fails with expected error codes", async () => {
  const raw = await sample("invalid-invoice.xml");
  const result = await validateDocument(raw);
  assert.equal(isValid(result), false);
  const codes = new Set(result.issues.map((i) => i.code));
  assert.ok(codes.has("TIN-LEGACY-PREFIX"));
  assert.ok(codes.has("LINE-CLASS-UNKNOWN"));
  assert.ok(codes.has("SIG-EXTENSION-MISSING"));
});

test("unrecognised input is reported, not thrown", async () => {
  const result = await validateDocument("not a document at all");
  assert.equal(isValid(result), false);
  assert.equal(result.issues[0]?.code, "INPUT-FORMAT-UNKNOWN");
});

test("malformed JSON is reported as a parse error", async () => {
  const result = await validateDocument("{ this is not valid json");
  assert.equal(isValid(result), false);
  assert.equal(result.issues[0]?.code, "INPUT-JSON-PARSE");
});

// --- TIN validator unit tests -------------------------------------------

test("TIN: valid company TIN passes", () => {
  const issues = validateTin("C2584563222", "Supplier", "Supplier.TIN");
  assert.equal(issues.length, 0);
});

test("TIN: valid individual TIN passes", () => {
  const issues = validateTin("IG115002000", "Buyer", "Buyer.TIN");
  assert.equal(issues.length, 0);
});

test("TIN: legacy SG prefix is flagged", () => {
  const issues = validateTin("SG123456789", "Supplier", "Supplier.TIN");
  assert.ok(issues.some((i) => i.code === "TIN-LEGACY-PREFIX"));
});

test("TIN: unrecognised prefix is flagged", () => {
  const issues = validateTin("ZZ123456789", "Supplier", "Supplier.TIN");
  assert.ok(issues.some((i) => i.code === "TIN-FORMAT-UNKNOWN"));
});

test("TIN: general public TIN is accepted", () => {
  const issues = validateTin("EI00000000010", "Buyer", "Buyer.TIN");
  assert.equal(issues.length, 0);
});

test("TIN: missing TIN is an error", () => {
  const issues = validateTin(undefined, "Supplier", "Supplier.TIN");
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "TIN-MISSING");
});
