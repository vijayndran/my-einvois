import type { ValidationIssue, Severity } from "../types.js";

export function issue(
  code: string,
  severity: Severity,
  message: string,
  path?: string
): ValidationIssue {
  return { code, severity, message, path };
}

export function err(code: string, message: string, path?: string): ValidationIssue {
  return issue(code, "error", message, path);
}

export function warn(code: string, message: string, path?: string): ValidationIssue {
  return issue(code, "warning", message, path);
}

/** MyInvois dates must be xsd:date, e.g. 2024-07-23 */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** MyInvois times must be xsd:time in UTC with trailing Z, e.g. 15:30:00Z */
export const TIME_RE = /^\d{2}:\d{2}:\d{2}Z$/;

export function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Amounts on the wire are decimals; compare with a small tolerance to
 * absorb legitimate rounding (MyInvois totals are typically 2dp, but
 * intermediate values may carry more precision).
 */
export function approxEqual(a: number, b: number, tolerance = 0.02): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/** RFC 5321/5322-ish sanity check -- not exhaustive, just catches obvious junk */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E.164-ish sanity check per the Supplier/Buyer Contact Number field */
export const PHONE_RE = /^\+?[0-9][0-9\-\s]{6,19}$/;
