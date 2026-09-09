import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeDocumentDetails } from "../src/diagnostics.js";

test("decodes a Valid document with no diagnostics", () => {
  const details = {
    uuid: "UUID123456789012345678901A",
    longId: "LONG987654321",
    validationResults: { status: "Valid", validationSteps: [{ name: "Step01", status: "Valid" }] },
  };
  const r = decodeDocumentDetails(details);
  assert.equal(r.valid, true);
  assert.equal(r.status, "Valid");
  assert.equal(r.uuid, "UUID123456789012345678901A");
  assert.equal(r.longId, "LONG987654321");
  assert.equal(r.diagnostics.length, 0);
});

test("decodes the real ERR236 rejection shape and attaches a fix hint", () => {
  // This is the exact shape observed from LHDN UAT Get Document Details.
  const details = {
    uuid: "0VH6HS1SCEHYEHKYSH7C532M10",
    longId: "",
    validationResults: {
      status: "Invalid",
      validationSteps: [
        { name: "Step01-Standard Validator", status: "Valid" },
        {
          name: "Step05-Taxpayer Profile Validator",
          status: "Invalid",
          error: {
            propertyName: null,
            propertyPath: null,
            errorCode: "Error05",
            error: "Step05-Invalid Taxpayer Profile Validator",
            innerError: [
              {
                propertyName: "CustomerTin",
                propertyPath: "document.Invoice.AccountingCustomerParty.Party.PartyIdentification.ID",
                errorCode: "ERR236",
                error: "Where General TIN (010) and ID Type BRN/NRIC = NA, applicable for Classification Code 004 only",
                innerError: null,
              },
            ],
          },
        },
      ],
    },
  };
  const r = decodeDocumentDetails(details);
  assert.equal(r.valid, false);
  assert.equal(r.status, "Invalid");
  // The wrapper (Error05) is skipped; only the specific inner ERR236 is surfaced.
  assert.equal(r.diagnostics.length, 1);
  const d = r.diagnostics[0];
  assert.equal(d.code, "ERR236");
  assert.equal(d.step, "Step05-Taxpayer Profile Validator");
  assert.match(d.message, /Classification Code 004/);
  assert.equal(d.propertyPath, "document.Invoice.AccountingCustomerParty.Party.PartyIdentification.ID");
  assert.ok(d.hint && /classification code must be 004/i.test(d.hint), "expected ERR236 fix hint");
  assert.equal(d.severity, "error");
});

test("decodes CF321 (date window) with a fix hint", () => {
  const details = {
    validationResults: {
      status: "Invalid",
      validationSteps: [
        {
          name: "Step04",
          status: "Invalid",
          error: {
            errorCode: "CF321",
            message: "Document issuance date time is in the future",
            propertyPath: "Invoice.IssueDate AND Invoice.IssueTime",
            innerError: null,
          },
        },
      ],
    },
  };
  const r = decodeDocumentDetails(details);
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0].code, "CF321");
  assert.match(r.diagnostics[0].message, /future/);
  assert.ok(r.diagnostics[0].hint && /72 hours/.test(r.diagnostics[0].hint));
});

test("unknown error codes still surface a message but no hint", () => {
  const details = {
    validationResults: {
      status: "Invalid",
      validationSteps: [
        { name: "StepX", status: "Invalid", error: { errorCode: "ZZ999", message: "Mystery failure", innerError: null } },
      ],
    },
  };
  const r = decodeDocumentDetails(details);
  assert.equal(r.diagnostics.length, 1);
  assert.equal(r.diagnostics[0].code, "ZZ999");
  assert.equal(r.diagnostics[0].message, "Mystery failure");
  assert.equal(r.diagnostics[0].hint, undefined);
});

test("tolerates missing/empty validationResults", () => {
  assert.equal(decodeDocumentDetails(undefined).status, "Unknown");
  assert.equal(decodeDocumentDetails({}).diagnostics.length, 0);
  assert.equal(decodeDocumentDetails({ status: "Submitted" }).status, "Submitted");
});
