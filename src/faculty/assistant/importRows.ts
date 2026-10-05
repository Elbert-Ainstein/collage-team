// The assistant's reading of a class list, as the file the importer expects.
//
// Text rather than parsed rows, on purpose: going back through parseRoster
// means the assistant's rows get exactly the cleaning a dropped file gets —
// lower-cased addresses, "Last, First" flipped, duplicates folded — and land in
// the importer's own preview with nothing special about them.

import type { ImportRow } from "@/assistant/types";

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rowsToCsv(rows: ImportRow[]): string {
  return [
    "name,email,team",
    ...rows.map((r) => [cell(r.name), cell(r.email ?? ""), r.team == null ? "" : String(r.team)].join(",")),
  ].join("\n");
}

/** An address, wherever it sits in a line — the same shape rosterImport reads. */
const EMAIL = /[A-Za-z0-9!#$%&'*+/=?^_`{}~.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Addresses in the assistant's rows that the instructor never wrote.
 *
 * An address is what a student signs in with, so one the model mis-copied is a
 * roster row nobody can claim — and the importer's preview counts rows, it does
 * not list them. Whole addresses only: "al@x.edu" is not in "sal@x.edu".
 */
export function emailsNotIn(rows: ImportRow[], written: string[]): string[] {
  const seen = new Set(written.flatMap((t) => (t.match(EMAIL) ?? []).map((e) => e.toLowerCase())));
  return rows.flatMap((r) => (r.email && !seen.has(r.email.toLowerCase()) ? [r.email] : []));
}
