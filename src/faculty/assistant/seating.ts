// A drafted seating, checked against the class as it is now, and written.
//
// The assistant's seat_students draft says "this student, that team" in refs.
// This is the half that decides whether the draft still makes sense — every ref
// found, nobody on two teams, no two teams sharing a name — and turns it into
// the same three writes the team import makes: rename, create, move.
//
// It keeps the import's promises (see teamImport.ts) for the same reasons:
//
// NOTHING IS DELETED. Students move between teams and new teams are made;
// moving writes to team_members alone, so every photo, recording and score
// filed against a team survives. A team the draft empties is left standing.
//
// ANYONE THE DRAFT DOES NOT MENTION STAYS PUT.
//
// A DRAFT IS APPLIED WHOLE OR NOT AT ALL. Any ref the class does not have keeps
// Apply shut. Applying the rest would quietly do part of what she asked, and
// the part left out is exactly the one the model got wrong.

import type { SeatProposal } from "@/assistant/types";
import { createTeam, moveStudents, renameTeam } from "@/checkins/data";
import { targetSet } from "@/checkins/teamImport";
import type { TeamChangeRecord } from "@/checkins/teamUndo";
import type { Student, TeamWithMembers } from "@/checkins/types";
import type { Refs } from "./snapshot";

export interface SeatChange {
  student: Student;
  /** The team they are on today, by today's name. Null when on none. */
  from: string | null;
  /** Every team they are on today, by id — what Undo puts them back on. */
  fromIds: string[];
  /** The team they will be on, by the name it will have. */
  to: string;
  toNew: boolean;
}

/** Everyone going to one team. `teamId` is null for a team still to be made. */
export interface SeatGroup {
  teamId: string | null;
  name: string;
  studentIds: string[];
}

export interface Seating {
  summary: string;
  setId: string | null;
  /** Only sizes a team set made from nothing. */
  size: number;
  nextPosition: number;
  /** Every team in the set. moveStudents clears a student out of all of them. */
  teamIds: string[];
  changes: SeatChange[];
  groups: SeatGroup[];
  newTeams: string[];
  renames: { teamId: string; from: string; to: string }[];
  /** Each team the draft adds to or takes from, and how many it ends with. */
  after: { name: string; count: number; isNew: boolean }[];
  /** Teams that have people today and will have nobody. Left standing. */
  emptied: string[];
  unresolved: { entry: string; reason: string }[];
  /** Anything that keeps Apply shut. */
  problems: string[];
}

/** What an Apply did, kept so it can be undone. See teamUndo.ts. */
export type SeatRecord = TeamChangeRecord;

export interface SeatOutcome {
  moved: number;
  created: number;
  renamed: number;
  record: SeatRecord;
}

type Target = { kind: "existing"; team: TeamWithMembers } | { kind: "new"; key: string; name: string };

const keyOf = (t: Target) => (t.kind === "existing" ? `id:${t.team.id}` : `new:${t.key}`);
const fold = (name: string) => name.trim().toLowerCase();
const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/** What each team is called once the draft's renames are made. */
function planRenames(p: SeatProposal, find: (ref: string) => TeamWithMembers | null, problems: string[]) {
  const to = new Map<string, string>();
  for (const r of p.renames) {
    const team = find(r.team);
    if (!team) continue;
    const before = to.get(team.id);
    if (before !== undefined && before !== r.name) {
      problems.push(`The draft renames ${team.name} twice — to "${before}" and to "${r.name}".`);
    } else if (r.name !== team.name) {
      to.set(team.id, r.name);
    }
  }
  return to;
}

/**
 * A rename that lands on a name another team has. Only clashes the DRAFT makes:
 * two teams that already share a name are the instructor's business, and
 * refusing every draft on that course because of them would be refusing the
 * assistant over something it did not do.
 */
function renameClashes(
  teams: TeamWithMembers[],
  renameTo: Map<string, string>,
  nameOf: (t: TeamWithMembers) => string,
): string[] {
  const clashing = [...renameTo].filter(([id, name]) =>
    teams.some((t) => t.id !== id && fold(nameOf(t)) === fold(name)),
  );
  return [...new Set(clashing.map(([, name]) => `Two teams would both be called "${name}".`))];
}

/** Where each student the draft names is going. */
function planTargets(
  p: SeatProposal,
  ctx: {
    refs: Refs;
    student: Map<string, Student>;
    find: (ref: string) => TeamWithMembers | null;
    byName: Map<string, TeamWithMembers>;
  },
  problems: string[],
): Map<string, Target> {
  const targets = new Map<string, Target>();
  const newSpelling = new Map<string, string>();
  for (const m of p.moves) {
    const id = ctx.refs.students.get(m.student);
    if (!id) {
      problems.push(`The draft names a student (${m.student}) the class does not have.`);
      continue;
    }
    const s = ctx.student.get(id);
    if (!s) {
      problems.push(`A student the draft names (${m.student}) is no longer on the roster.`);
      continue;
    }
    let target: Target | null = null;
    if (m.toTeam) {
      const team = ctx.find(m.toTeam);
      target = team ? { kind: "existing", team } : null;
    } else if (m.toNewTeam) {
      const key = fold(m.toNewTeam);
      const twin = ctx.byName.get(key);
      if (!newSpelling.has(key)) newSpelling.set(key, m.toNewTeam);
      target = twin ? { kind: "existing", team: twin } : { kind: "new", key, name: newSpelling.get(key)! };
    }
    if (!target) continue;
    const prev = targets.get(s.id);
    if (prev && keyOf(prev) !== keyOf(target)) {
      problems.push(`The draft puts ${s.name} on two teams.`);
      continue;
    }
    targets.set(s.id, target);
  }
  return targets;
}

export function planSeating(
  proposal: SeatProposal,
  refs: Refs,
  roster: Student[],
  teams: TeamWithMembers[],
): Seating {
  const problems: string[] = [];
  const ordered = [...teams].sort(byPosition);
  const teamById = new Map(ordered.map((t) => [t.id, t]));
  const student = new Map(roster.map((s) => [s.id, s]));

  const find = (ref: string): TeamWithMembers | null => {
    const id = refs.teams.get(ref);
    if (!id) problems.push(`The draft names a team (${ref}) the class does not have.`);
    else if (!teamById.has(id)) problems.push(`A team the draft names (${ref}) has since been deleted.`);
    return id ? (teamById.get(id) ?? null) : null;
  };

  const renameTo = planRenames(proposal, find, problems);
  const nameOf = (t: TeamWithMembers) => renameTo.get(t.id) ?? t.name;
  problems.push(...renameClashes(ordered, renameTo, nameOf));
  // First on the screen wins when two teams already share a name.
  const byName = new Map([...ordered].reverse().map((t) => [fold(nameOf(t)), t]));

  const targets = planTargets(proposal, { refs, student, find, byName }, problems);
  return describe(proposal, { ordered, roster, targets, nameOf, renameTo, problems });
}

/** The writes and the preview, from targets that have already been checked. */
function describe(
  proposal: SeatProposal,
  ctx: {
    ordered: TeamWithMembers[];
    roster: Student[];
    targets: Map<string, Target>;
    nameOf: (t: TeamWithMembers) => string;
    renameTo: Map<string, string>;
    problems: string[];
  },
): Seating {
  const { ordered, targets, nameOf } = ctx;
  const onTeams = new Map<string, TeamWithMembers[]>();
  for (const t of ordered) for (const m of t.members) onTeams.set(m.id, [...(onTeams.get(m.id) ?? []), t]);

  const changes: SeatChange[] = [];
  const groups = new Map<string, SeatGroup>();
  for (const [sid, target] of targets) {
    const now = onTeams.get(sid) ?? [];
    if (target.kind === "existing" && now.length === 1 && now[0].id === target.team.id) continue;
    const to = target.kind === "existing" ? nameOf(target.team) : target.name;
    const from = now.filter((t) => target.kind !== "existing" || t.id !== target.team.id);
    changes.push({
      student: ctx.roster.find((s) => s.id === sid) as Student,
      from: from.length ? from.map((t) => t.name).join(", ") : null,
      fromIds: now.map((t) => t.id),
      to,
      toNew: target.kind === "new",
    });
    const k = keyOf(target);
    const g = groups.get(k) ?? { teamId: target.kind === "existing" ? target.team.id : null, name: to, studentIds: [] };
    groups.set(k, { ...g, studentIds: [...g.studentIds, sid] });
  }

  const moving = new Set(changes.map((c) => c.student.id));
  const incoming = (id: string) => groups.get(`id:${id}`)?.studentIds.length ?? 0;
  const touched = ordered.filter((t) => incoming(t.id) || t.members.some((m) => moving.has(m.id)));
  const count = (t: TeamWithMembers) => t.members.filter((m) => !moving.has(m.id)).length + incoming(t.id);
  const fresh = [...groups.values()].filter((g) => !g.teamId);
  const after = [
    ...touched.map((t) => ({ name: nameOf(t), count: count(t), isNew: false })),
    ...fresh.map((g) => ({ name: g.name, count: g.studentIds.length, isNew: true })),
  ];

  return {
    summary: proposal.summary,
    setId: ordered[0]?.team_set_id ?? null,
    size: Math.max(2, ...after.map((a) => a.count)),
    nextPosition: ordered.reduce((n, t) => Math.max(n, t.position), -1) + 1,
    teamIds: ordered.map((t) => t.id),
    changes,
    groups: [...groups.values()],
    newTeams: fresh.map((g) => g.name),
    renames: [...ctx.renameTo].map(([teamId, to]) => ({
      teamId,
      from: ordered.find((t) => t.id === teamId)?.name ?? "",
      to,
    })),
    after,
    emptied: touched.filter((t) => t.members.length > 0 && count(t) === 0).map(nameOf),
    unresolved: proposal.unresolved,
    // Once each: three moves to the same missing team are one problem.
    problems: [...new Set(ctx.problems)],
  };
}

/**
 * Rename, create, then move. Every new team exists before anyone moves, so each
 * move is told about every team in the set and a student can never be left on
 * two at once.
 *
 * Safe to run again after a failure: renames repeat harmlessly, and the panel
 * re-plans against the refreshed class first — where a team the failed run did
 * create is now an existing team of that name, and is joined, not made twice.
 */
export async function applySeating(courseId: string, s: Seating): Promise<SeatOutcome> {
  if (s.problems.length) throw new Error(`This draft cannot be applied: ${s.problems[0]}`);

  for (const r of s.renames) await renameTeam(r.teamId, r.to);
  const renamed = s.renames.map((r) => ({ teamId: r.teamId, from: r.from, to: r.to }));
  if (!s.groups.length) {
    return { moved: 0, created: 0, renamed: s.renames.length, record: { moved: [], created: [], renamed } };
  }

  const setId = s.setId ?? (await targetSet(courseId, s.size));
  const made = new Map<SeatGroup, string>();
  let position = s.nextPosition;
  for (const g of s.groups) {
    if (g.teamId) continue;
    const row = await createTeam(setId, g.name, position++);
    made.set(g, row.id);
  }

  const ids = [...s.teamIds, ...made.values()];
  const idOf = (g: SeatGroup) => g.teamId ?? (made.get(g) as string);
  let moved = 0;
  for (const g of s.groups) {
    await moveStudents(g.studentIds, idOf(g), ids);
    moved += g.studentIds.length;
  }

  const targetOf = new Map(s.groups.flatMap((g) => g.studentIds.map((sid) => [sid, idOf(g)] as const)));
  const record: SeatRecord = {
    moved: s.changes.map((c) => ({
      studentId: c.student.id,
      from: c.fromIds,
      to: targetOf.get(c.student.id) as string,
    })),
    created: [...made].map(([g, teamId]) => ({ teamId, name: g.name })),
    renamed,
  };
  return { moved, created: made.size, renamed: s.renames.length, record };
}
