import { GENERAL_TINS } from "../data/codes.js";
import { err, warn } from "./common.js";
import type { ValidationIssue } from "../types.js";

/**
 * Non-individual TIN prefixes currently recognised by LHDN, as listed in
 * the SDK FAQ (https://sdk.myinvois.hasil.gov.my/faq/):
 * C, CS, D, F, FA, PT, TA, TC, TN, TR, TP, J, LE
 */
const NON_INDIVIDUAL_PREFIXES = ["CS", "TA", "TC", "TN", "TR", "TP", "FA", "LE", "C", "D", "F", "PT", "J"];

/** Individual TIN prefix, effective 1 Jan 2023 (replaces legacy SG / OG) */
const INDIVIDUAL_PREFIX = "IG";
const LEGACY_INDIVIDUAL_PREFIXES = ["SG", "OG"];

const MAX_TIN_LENGTH = 14;

export function validateTin(tin: string | undefined, label: string, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!tin || tin.trim() === "") {
    issues.push(err("TIN-MISSING", `${label} TIN is mandatory and was not found.`, path));
    return issues;
  }

  const value = tin.trim();

  if (value in GENERAL_TINS) {
    return issues; // valid general TIN, nothing further to check
  }

  if (value.length > MAX_TIN_LENGTH) {
    issues.push(
      err(
        "TIN-LENGTH",
        `${label} TIN "${value}" is ${value.length} characters; LHDN TINs are at most ${MAX_TIN_LENGTH} characters including the prefix.`,
        path
      )
    );
  }

  if (value.startsWith(INDIVIDUAL_PREFIX)) {
    const digits = value.slice(INDIVIDUAL_PREFIX.length);
    if (!/^\d{9,11}$/.test(digits)) {
      issues.push(
        err(
          "TIN-FORMAT-INDIVIDUAL",
          `${label} TIN "${value}" starts with IG but the remaining ${digits.length} characters are not 9-11 digits.`,
          path
        )
      );
    }
    return issues;
  }

  const legacyPrefix = LEGACY_INDIVIDUAL_PREFIXES.find((p) => value.startsWith(p));
  if (legacyPrefix) {
    issues.push(
      err(
        "TIN-LEGACY-PREFIX",
        `${label} TIN "${value}" uses the legacy "${legacyPrefix}" prefix. Individual TINs were migrated to the "IG" prefix on 1 January 2023 -- update to IG${value.slice(
          legacyPrefix.length
        )}.`,
        path
      )
    );
    return issues;
  }

  const matchedPrefix = NON_INDIVIDUAL_PREFIXES.find((p) => value.startsWith(p));
  if (!matchedPrefix) {
    issues.push(
      err(
        "TIN-FORMAT-UNKNOWN",
        `${label} TIN "${value}" does not match any recognised LHDN prefix (IG for individuals; C, CS, D, F, FA, PT, TA, TC, TN, TR, TP, J, LE for non-individuals; or a general TIN).`,
        path
      )
    );
    return issues;
  }

  const digits = value.slice(matchedPrefix.length);
  if (!/^\d+$/.test(digits) || digits.length === 0) {
    issues.push(
      err(
        "TIN-FORMAT-NONINDIVIDUAL",
        `${label} TIN "${value}" has prefix "${matchedPrefix}" but the remainder is not purely numeric.`,
        path
      )
    );
  } else if (digits.startsWith("0")) {
    issues.push(
      warn(
        "TIN-LEADING-ZERO",
        `${label} TIN "${value}" has a leading zero immediately after the prefix. Post-2023 TINs should omit it (e.g. C96000000XX, not C096000000XX) unless this is a pre-2023 TIN, which LHDN says should keep a trailing zero instead.`,
        path
      )
    );
  }

  return issues;
}
