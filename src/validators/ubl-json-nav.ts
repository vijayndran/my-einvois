import type { ValidationIssue } from "../types.js";
import { err } from "./common.js";

/**
 * MyInvois JSON follows the "UBL 2.1 JSON Alternative Representation":
 * every element is an array of objects, and a leaf value sits under the
 * "_" key of that object, e.g.
 *
 *   "ID": [ { "_": "INV12345" } ]
 *   "InvoiceTypeCode": [ { "_": "01", "listVersionID": "1.0" } ]
 *
 * This module centralises that navigation so callers can write
 * `leaf(node, "ID")` instead of repeating the array/"_"  dance, and so we
 * can flag the common real-world mistake of submitting flat (non-array)
 * JSON in one place.
 */

export function reportIfNotArray(obj: unknown, key: string, path: string, issues: ValidationIssue[]): void {
  if (obj && typeof obj === "object" && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    if (!Array.isArray(v)) {
      issues.push(
        err(
          "JSON-STRUCT-NOT-ARRAY",
          `"${key}" should be wrapped in an array per the UBL 2.1 JSON Alternative Representation (e.g. "${key}": [ { ... } ]), but a plain value/object was found.`,
          path
        )
      );
    }
  }
}

export function arr(obj: unknown, key: string): Record<string, unknown>[] {
  if (!obj || typeof obj !== "object") return [];
  const v = (obj as Record<string, unknown>)[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

export function firstObj(obj: unknown, key: string): Record<string, unknown> | undefined {
  return arr(obj, key)[0];
}

export function leaf(obj: unknown, key: string): string | undefined {
  const o = firstObj(obj, key);
  if (o === undefined) return undefined;
  if ("_" in o && o._ !== undefined && o._ !== null) return String(o._);
  return undefined;
}

export function leafNum(obj: unknown, key: string): number | undefined {
  const o = firstObj(obj, key);
  if (o === undefined || !("_" in o)) return undefined;
  const v = o._;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

export function attr(obj: unknown, key: string, attrName: string): string | undefined {
  const o = firstObj(obj, key);
  const v = o?.[attrName];
  return typeof v === "string" ? v : undefined;
}

/** All values of a repeated child leaf, e.g. every CommodityClassification/ItemClassificationCode */
export function leafAll(objs: Record<string, unknown>[], key: string): string[] {
  return objs
    .flatMap((o) => arr(o, key))
    .map((o) => (("_" in o && o._ !== undefined) ? String(o._) : undefined))
    .filter((v): v is string => v !== undefined);
}
