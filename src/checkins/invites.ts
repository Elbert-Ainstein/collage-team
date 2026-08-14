// Invite codes: the only way onto a roster (supabase/migrations/0029).
//
// Read the shape of this before using it, because it is not symmetric. LISTING
// and ROTATING go straight at the table and only work for the course's owner —
// RLS is what says so, not this file. REDEEMING cannot go at the table at all:
// a student who could select course_invites could read every live code in the
// database, so there is no read policy for them and redemption happens inside
// join_with_code(), which looks at the code on their behalf and tells them
// nothing except whether it worked.
//
// So the errors from redeem() are the product, not an afterthought. The
// database raises three distinct ones — no such code, revoked code, code fine
// but you are not on that roster — and they arrive here as plain sentences
// meant to be shown as-is. Do not collapse them into "that didn't work"; the
// third is the case a real student hits when their instructor mistyped their
// address, and it is the only thing that tells them who to go and ask.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError } from "./data";

const db = () => requireSupabase();

/** A student code and a TF code per course, rotatable independently. */
export type InviteKind = "student" | "tf";

export interface CourseInvite {
  id: string;
  course_id: string;
  kind: InviteKind;
  code: string;
  /** Set when the code was burnt. A revoked code is kept so a stale one can be named as stale. */
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
}

/** What redeeming a code got you — enough to confirm on screen what you just joined. */
export interface JoinedCourse {
  course_id: string;
  course_name: string;
  course_code: string | null;
  kind: InviteKind;
}

/**
 * Join a course by presenting its code.
 *
 * Whitespace and hyphens are fine; the database normalises what arrives, so
 * pass the field's raw value rather than trimming it into a different shape
 * here and having two definitions of what a code looks like.
 *
 * Idempotent — redeeming twice, or when already enrolled, returns the course
 * rather than throwing, so a double-tapped button on a phone is not an error.
 */
export async function redeemInviteCode(code: string): Promise<JoinedCourse> {
  const { data, error } = await db().rpc("join_with_code", { code });
  if (error) throw dbError(error);

  // `returns table` comes back as an array of one. An empty one would mean the
  // function returned without raising, which it cannot; say so rather than
  // handing the caller an undefined course.
  const rows = (data as JoinedCourse[] | null) ?? [];
  if (!rows[0]) throw new Error("That code was accepted but the course did not come back. Reload and check.");
  return rows[0];
}

/** The live codes for a course, one per kind. Owner only — RLS returns nothing to anyone else. */
export async function listInviteCodes(courseId: string): Promise<CourseInvite[]> {
  const { data, error } = await db()
    .from("course_invites")
    .select("*")
    .eq("course_id", courseId)
    .is("revoked_at", null)
    .order("kind");
  if (error) throw dbError(error);
  return (data as CourseInvite[] | null) ?? [];
}

/**
 * Burn the current code for this course and kind, and return its replacement.
 *
 * One RPC rather than a revoke followed by an insert: between those two the
 * course has no code at all, and a failure in the second half would leave it
 * that way with nobody aware.
 */
export async function rotateInviteCode(courseId: string, kind: InviteKind): Promise<CourseInvite> {
  const { data, error } = await db().rpc("rotate_invite_code", { cid: courseId, invite_kind: kind });
  if (error) throw dbError(error);
  const row = data as CourseInvite | null;
  if (!row) throw new Error("The new code did not come back. Reload to see the current one.");
  return row;
}

/**
 * Split into two groups for display: XXXX-XXXX.
 *
 * Display only. The stored code has no separator, and the database strips
 * anything outside A-Z0-9 on redemption, so a student can type it back either
 * way — with the hyphen they can see, or without.
 */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
