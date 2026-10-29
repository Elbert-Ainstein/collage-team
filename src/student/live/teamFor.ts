// Who's on the team a live activity runs with, from a student's seat.

import type { Enrolment } from "@/checkins/studentData";
import type { Student, TeamWithMembers } from "@/checkins/types";
import type { LiveSnapshot } from "@/live/types";

/** Someone the screen can't name: a seat with the student's own course. */
const stranger = (enrolment: Enrolment, id: string, name: string | null, tint: string | null): Student =>
  ({ ...enrolment.student, id, name: name ?? "Teammate", avatar_tint: tint }) as Student;

/**
 * The frozen roster's people (0051 lets a team read it once team mode has
 * started) — exactly who the leader RPCs count. Null when there is none to go by.
 */
function rosterIds(teamId: string, snap: LiveSnapshot | null): string[] | null {
  if (!snap || snap.state.phase === "individual") return null;
  const ids = snap.roster.filter((r) => r.team_id === teamId).map((r) => r.student_id);
  return ids.length > 0 ? ids : null;
}

/**
 * Without a roster to read (before team mode, or before 0051): the team they
 * are on now if it is the same one, and whoever the answers and votes they
 * can read belong to.
 */
function seenIds(enrolment: Enrolment, teamId: string, snap: LiveSnapshot | null): string[] {
  const ids = new Set<string>([enrolment.student.id]);
  if (enrolment.team?.id === teamId) for (const s of enrolment.teammates) ids.add(s.id);
  for (const v of snap?.votes ?? []) if (v.team_id === teamId) ids.add(v.student_id);
  if (snap && snap.state.phase !== "individual") for (const r of snap.responses) ids.add(r.student_id);
  return [...ids];
}

/**
 * Who's on the team this activity runs with. Before team mode, the team they
 * are on now. After, the frozen one (`teamId`, 0045): its roster when the
 * database lets them read it, so the screen counts the people the leader
 * vote, the roll and lock rule 'all' count — even if the instructor has moved
 * someone since.
 */
export function teamFor(enrolment: Enrolment, teamId: string | null, snap: LiveSnapshot | null): TeamWithMembers | null {
  const id = teamId ?? enrolment.team?.id ?? null;
  if (!id) return null;
  const known = new Map<string, Student>([
    [enrolment.student.id, enrolment.student],
    ...enrolment.teammates.map((s) => [s.id, s] as const),
  ]);
  const named = new Map((snap?.roster ?? []).map((r) => [r.student_id, r] as const));
  const ids = rosterIds(id, snap) ?? seenIds(enrolment, id, snap);
  const members = ids
    .map((sid) => known.get(sid) ?? stranger(enrolment, sid, named.get(sid)?.name ?? null, named.get(sid)?.avatar_tint ?? null))
    .sort((a, b) => (a.id === enrolment.student.id ? -1 : b.id === enrolment.student.id ? 1 : a.name.localeCompare(b.name)));
  const sameTeam = enrolment.team?.id === id;
  return {
    ...(enrolment.team ?? { id, name: "Your team" }),
    id,
    name: sameTeam && enrolment.team ? enrolment.team.name : "Your team",
    members,
  } as TeamWithMembers;
}
