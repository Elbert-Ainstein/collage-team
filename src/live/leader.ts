// A team's leader, its roll, and its explanations (0051), as screens ask.
//
// Pure, from the snapshot and the team's members. The database decides all of
// this for itself — live_leader_tally, live_team_leader and live_leads in
// 0051 — and these say the same thing to the screen, so "Confirm A2" shows
// exactly when confirm_live_leader would take it, and the submit button
// exactly when lock_team_answer would.

import type { AbsenceSource, LiveSnapshot } from "./types";

/** Where a team is: picking a leader, the leader taking the roll, or playing. */
export type TeamStage = "leader" | "roll" | "play";

export interface LeaderTally {
  /** Each counted voter's pick: student id → candidate id. */
  picks: Readonly<Record<string, string>>;
  /** Counted votes per candidate. */
  counts: Readonly<Record<string, number>>;
  /** How many counted votes there are. */
  voted: number;
  /** How many on the team are there (not marked absent). */
  present: number;
  /** The one name every counted vote is for; null when there are none, or they're split. */
  agreed: string | null;
  /** Votes for more than one person. */
  split: boolean;
  /** Everyone who is there has voted. */
  everyoneVoted: boolean;
  /** "Confirm <name>" would be taken: agreed, and two have voted — or everyone has. */
  canConfirm: boolean;
}

/** Is this student marked absent for the activity — on any team, as the database asks it? */
export function isAbsent(snapshot: LiveSnapshot, studentId: string): boolean {
  return snapshot.absences.some((a) => a.student_id === studentId);
}

/** Who on this team is marked absent — by either, or only by the sheet or the roll. */
export function absentIds(snapshot: LiveSnapshot, teamId: string, source?: AbsenceSource): string[] {
  return snapshot.absences
    .filter((a) => a.team_id === teamId && (source === undefined || a.source === source))
    .map((a) => a.student_id);
}

const setupOf = (snapshot: LiveSnapshot, teamId: string) =>
  snapshot.setups.find((s) => s.team_id === teamId) ?? null;

/** The team's leader — none while the one it picked is marked absent (live_team_leader). */
export function leaderOf(snapshot: LiveSnapshot, teamId: string): string | null {
  const leader = setupOf(snapshot, teamId)?.leader_id ?? null;
  return leader !== null && !isAbsent(snapshot, leader) ? leader : null;
}

/**
 * Where the vote for leader stands (live_leader_tally). Counts only people who
 * are there, as voters and as candidates, and only members of this team.
 */
export function leaderTally(snapshot: LiveSnapshot, teamId: string, memberIds: readonly string[]): LeaderTally {
  const here = new Set(memberIds.filter((id) => !isAbsent(snapshot, id)));
  const counted = snapshot.leaderVotes.filter(
    (v) => v.team_id === teamId && here.has(v.student_id) && here.has(v.candidate_id),
  );
  const picks = Object.fromEntries(counted.map((v) => [v.student_id, v.candidate_id]));
  const counts = counted.reduce<Record<string, number>>(
    (acc, v) => ({ ...acc, [v.candidate_id]: (acc[v.candidate_id] ?? 0) + 1 }),
    {},
  );
  const names = Object.keys(counts);
  const voted = counted.length;
  const agreed = names.length === 1 ? names[0] : null;
  const everyoneVoted = here.size > 0 && voted >= here.size;
  return {
    picks,
    counts,
    voted,
    present: here.size,
    agreed,
    split: names.length > 1,
    everyoneVoted,
    canConfirm: agreed !== null && (voted >= 2 || everyoneVoted),
  };
}

/**
 * May this student act for the team — submit a try, move it on (live_leads)?
 * Anyone there, until the team has had a leader; then only its leader, and
 * nobody while the one it had is marked absent and it hasn't picked again.
 */
export function mayLead(snapshot: LiveSnapshot, teamId: string, studentId: string): boolean {
  if (isAbsent(snapshot, studentId)) return false;
  if (!setupOf(snapshot, teamId)?.leader_id) return true;
  return leaderOf(snapshot, teamId) === studentId;
}

/** Where the team is. Always "play" on a database without 0051. */
export function teamStage(snapshot: LiveSnapshot, teamId: string): TeamStage {
  if (!snapshot.teamSetup) return "play";
  if (leaderOf(snapshot, teamId) === null) return "leader";
  return setupOf(snapshot, teamId)?.roll_at ? "play" : "roll";
}

/** The question's explanation, if the caller may read one. */
export function explanationFor(snapshot: LiveSnapshot, questionId: string): string | null {
  return snapshot.explanations.find((e) => e.question_id === questionId)?.body ?? null;
}
