// Roster attributes: which columns teams can be mixed by, and their tints.

import { ATTR_TINTS, MIX_BY_NONE, NON_MIXABLE_ATTRS, type MixBy } from "./constants";
import type { Student, StudentAttrs } from "./types";

/**
 * The attribute keys present on this roster, in first-seen order. A key only
 * qualifies once at least two students carry it and they do not all share one
 * value — an attribute everyone matches on cannot mix anything.
 */
export function mixableAttrs(roster: Student[]): string[] {
  const values = new Map<string, Set<string>>();
  const counts = new Map<string, number>();

  for (const s of roster) {
    for (const [rawKey, rawValue] of Object.entries(s.attrs ?? {})) {
      const key = rawKey.trim().toLowerCase();
      const value = String(rawValue ?? "").trim();
      if (!key || !value || NON_MIXABLE_ATTRS.has(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const seen = values.get(key);
      if (seen) seen.add(value);
      else values.set(key, new Set([value]));
    }
  }

  return [...values.entries()]
    .filter(([key, seen]) => seen.size > 1 && (counts.get(key) ?? 0) > 1)
    .map(([key]) => key);
}

/**
 * A stable tint for a student's value of `mixBy` — hashed from the value so the
 * same major is the same colour on every card, not just within one.
 * Returns null when there is nothing to tint by.
 */
export function attrTint(student: { attrs?: StudentAttrs }, mixBy: MixBy): string | null {
  if (mixBy === MIX_BY_NONE) return null;
  const value = (student.attrs?.[mixBy] ?? "").trim();
  if (!value) return null;
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return ATTR_TINTS[h % ATTR_TINTS.length];
}
