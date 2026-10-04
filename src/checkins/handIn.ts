// When a student's own hand-in closes, and whether it has been reopened.
//
// The database is the rule (supabase/migrations/0044_hand_in_deadline.sql):
// after the individual deadline a student's work is frozen unless the
// instructor has reopened it for them. This restates that rule so a screen can
// say "closed" before a write is refused, rather than offering a Submit button
// that always fails. Keep the two in step: a screen that thinks a hand-in is
// open when the database does not is a student pressing Submit at 9:01 and
// being told they have no permission.

import type { Activity } from "./types";

type Dated = Pick<Activity, "due_at" | "individual_due_at">;

/**
 * The deadline the individual hand-in is judged against.
 *
 * due_at is what the faculty app writes (0007) and it is the INDIVIDUAL
 * deadline. The older per-scope column is honoured so activities authored
 * before 0007 keep their date. team_due_at is never a fallback: a team answer
 * is handed in at the check-in, and 0044 does not close it. This is the same
 * coalesce 0044 reads, and the date the Late flag is measured against.
 */
export function indivDueAt(act: Dated): string | null {
  return act.due_at ?? act.individual_due_at;
}

/**
 * Whether the individual deadline is behind us.
 *
 * Strictly after: work arriving AT the deadline is on time, in 0044 and in the
 * Late flag alike. An unparseable stamp is a broken row, not a deadline, so it
 * reads as open; the database still decides, and it holds a real timestamptz.
 */
export function pastDeadline(act: Dated, now: number = Date.now()): boolean {
  const due = indivDueAt(act);
  if (!due) return false;
  const at = Date.parse(due);
  if (Number.isNaN(at)) return false;
  return now > at;
}

/** Whether this student can no longer hand in: past the deadline and not reopened. */
export function handInClosed(act: Dated, reopened: boolean, now: number = Date.now()): boolean {
  return !reopened && pastDeadline(act, now);
}

/**
 * How long until a deadline (indivDueAt's answer) passes, for a screen that
 * wants to re-render the moment it does. Null when there is nothing to wait
 * for: no deadline, already past, or further off than setTimeout can count (a
 * 32-bit delay; anything longer fires at once), in which case the next refetch
 * is soon enough.
 */
export function msUntilClose(due: string | null, now: number = Date.now()): number | null {
  if (!due) return null;
  const at = Date.parse(due);
  if (Number.isNaN(at)) return null;
  // +1 because the deadline itself is still open; closed is strictly after it.
  const wait = at - now + 1;
  return wait > 0 && wait <= 2 ** 31 - 1 ? wait : null;
}
