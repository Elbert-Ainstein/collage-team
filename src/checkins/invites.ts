// Invite codes (supabase/migrations/0029), and below them the invitation an
// instructor addresses to one person by name (0032).
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
// database raises two distinct ones — no such code, and a code that has been
// rotated — and they arrive here as plain sentences meant to be shown as-is.
// Do not collapse them into "that didn't work": they are different acts (check
// your typing / go and ask for the current code) and only the sentence says
// which.
//
// There used to be a third, and its absence is the feature. 0029 refused anyone
// whose address the instructor had not imported first, so a real student
// holding a real code was turned away because they enrolled late or their
// address was typed wrong. 0030 inverted it: the roster row is what joining
// PRODUCES. Nobody has to be on a list before they can get on it.
//
// A code is still the only thing anyone can PRESENT. The invitations at the
// bottom of this file are the other direction — offers already waiting for the
// caller, which they accept or refuse — so nothing there takes a string typed
// into a box, and nothing there can be aimed at somebody else.

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

// ---------------------------------------------------------------------------
// Invitations (supabase/migrations/0032).
//
// The other way onto a TF list, and the one that does not need a code. An
// instructor types an address into her TF roster; that row is an OFFER until
// the person holding the address signs in and accepts it. Nothing here takes a
// user id: every one of these three answers about the caller's own address and
// no other, which is what lets them read a table a TF cannot select from.
//
// Read failures are the caller's to swallow, not to show. listMyTFInvitations
// runs beside the code box on a screen whose whole job is the code box, and an
// account with no invitations — nearly everyone — must not be told that
// something went wrong on their behalf.

/** A pending offer to join somebody's course as a TF. One per course. */
export interface TFInvitation {
  /** The course_tfs row. Passed back to accept or decline; it is not the authority on either. */
  invitation_id: string;
  course_id: string;
  course_name: string;
  course_code: string | null;
  /** The instructor's name, or her address when the account carries no name. */
  invited_by: string | null;
  invited_at: string;
}

/** Every pending invitation addressed to the signed-in account. Empty is the normal answer. */
export async function listMyTFInvitations(): Promise<TFInvitation[]> {
  const { data, error } = await db().rpc("my_tf_invitations");
  if (error) throw dbError(error);
  return (data as TFInvitation[] | null) ?? [];
}

/**
 * Accept one, and get back the course in the same shape redeeming a code
 * returns — the caller has one thing to do with "you are now on this course"
 * however the person got there.
 */
export async function acceptTFInvitation(invitationId: string): Promise<JoinedCourse> {
  const { data, error } = await db().rpc("accept_tf_invitation", { invitation_id: invitationId });
  if (error) throw dbError(error);
  const rows = (data as JoinedCourse[] | null) ?? [];
  if (!rows[0]) throw new Error("That was accepted but the course did not come back. Reload and check.");
  return rows[0];
}

/** Stop being asked. The instructor's roster row is left exactly as it was. */
export async function declineTFInvitation(invitationId: string): Promise<void> {
  const { error } = await db().rpc("decline_tf_invitation", { invitation_id: invitationId });
  if (error) throw dbError(error);
}

/**
 * Which of these TF rows have been declined — for the instructor looking at her
 * own list, so a row nobody is coming to stops reading as one she is waiting on.
 *
 * RLS on tf_invitation_declines answers only about courses she owns, so the
 * `in` is a filter and not the security. Skipped entirely for an empty list
 * rather than posting a query that cannot match anything.
 */
export async function listDeclinedTFInvitations(tfIds: string[]): Promise<Set<string>> {
  if (!tfIds.length) return new Set();
  const { data, error } = await db()
    .from("tf_invitation_declines")
    .select("course_tf_id")
    .in("course_tf_id", tfIds);
  if (error) throw dbError(error);
  return new Set(((data as { course_tf_id: string }[] | null) ?? []).map((d) => d.course_tf_id));
}
