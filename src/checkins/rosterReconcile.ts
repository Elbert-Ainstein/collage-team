// Deciding what an import actually changes.
//
// Importing a roster onto a roster that already has people is not a matter of
// adding everything: most rows are already there, some are there but missing an
// email, and a few are genuinely new. Getting this wrong is expensive in both
// directions — a spurious add leaves a duplicate student who can never be
// graded properly, and a spurious match silently hands one student another
// student's address.
//
// Identity is decided by email where there is one, because that is the only
// field that is actually unique. Name is a fallback, and a roster row may be
// claimed by at most ONE incoming student: that is what stops two classmates
// who share a name from collapsing into a single row.

import type { ParsedStudent } from "./rosterImport";

export interface RosterRowLike {
  id: string;
  name: string;
  email: string | null;
}

export interface Reconciliation<T extends RosterRowLike> {
  /** Students to insert. */
  fresh: ParsedStudent[];
  /** Existing rows that gain an address they were missing. */
  emailFills: { student: T; email: string }[];
  /**
   * Rows the file spells differently. Only ever from an ADDRESS match: the
   * address says which person the row is, so the file's name is a statement
   * about that person and not a guess at who they might be. A row matched by
   * name cannot be here — the names agreed, that is how it matched.
   *
   * This is the one thing an import overwrites, and it is why: a name is the
   * only field of a roster row that nothing else can repair, so a file that
   * fixes a mangled or misspelled one has to be able to say so. It is never
   * silent — the preview lists every old → new before anything is written.
   */
  nameFixes: { student: T; from: string; to: string }[];
  /** Rows already correct — counted so the preview can say "no change". */
  unchanged: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function reconcileRoster<T extends RosterRowLike>(
  roster: T[],
  parsed: ParsedStudent[],
): Reconciliation<T> {
  const claimed = new Set<string>();
  const fresh: ParsedStudent[] = [];
  const emailFills: { student: T; email: string }[] = [];
  const nameFixes: { student: T; from: string; to: string }[] = [];
  let unchanged = 0;

  // Pass 1 — email is identity. Matching these first stops a name match from
  // stealing a row that belongs to someone else.
  const byEmail = new Map<string, T>();
  for (const r of roster) {
    if (r.email) byEmail.set(norm(r.email), r);
  }
  const settled = new Set<ParsedStudent>();
  for (const p of parsed) {
    const hit = p.email ? byEmail.get(norm(p.email)) : undefined;
    if (hit && !claimed.has(hit.id)) {
      claimed.add(hit.id);
      settled.add(p);
      // Same person, spelled differently. Case and spacing alone are not a
      // rename — "ADA LOVELACE" out of an LMS is the same name shouted, and
      // rewriting the roster to it every import would be worse than leaving it.
      const to = p.name.trim();
      if (to && norm(to) !== norm(hit.name)) nameFixes.push({ student: hit, from: hit.name, to });
      else unchanged++;
    }
  }

  // Pass 2 — fall back to name, one row per incoming student.
  for (const p of parsed) {
    if (settled.has(p)) continue;
    const row = roster.find((r) => !claimed.has(r.id) && norm(r.name) === norm(p.name));
    if (!row) {
      // Either a new student, or the second person to share a name with a row
      // that has already been claimed. Both are genuinely new rows.
      fresh.push(p);
      continue;
    }
    claimed.add(row.id);
    if (p.email && !row.email) {
      emailFills.push({ student: row, email: p.email });
    } else {
      // The row already has an address. Never overwrite it from a file — a
      // changed address is a decision for the instructor, made inline.
      unchanged++;
    }
  }

  return { fresh, emailFills, nameFixes, unchanged };
}
