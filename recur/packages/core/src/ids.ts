import { randomUUID } from "node:crypto";

/**
 * Prefixed, sortable-enough identifiers. The prefix makes IDs self-describing
 * in logs and webhook payloads (`sub_…`, `in_…`), the way merchants are used to
 * from other billing APIs.
 */
export type IdPrefix = "plan" | "sub" | "in" | "evt" | "whk" | "mrc";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}
