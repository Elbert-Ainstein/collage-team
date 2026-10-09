// Undoing a change to the teams — an assistant draft, or a class-list import.
//
// Undo is a fact about what was written, so whatever writes a team change
// writes a record of it (TeamChangeRecord) and this puts it back: no request,
// no model, no way to "undo" something other than what happened.
//
// Checked against the class as it is NOW, three ways:
//
// A STUDENT GOES BACK ONLY IF THEY ARE STILL WHERE THE DRAFT PUT THEM. Between
// Apply and Undo she may have moved somebody by hand, or applied a second draft;
// dragging them back over that would undo her, not the draft.
//
// A RENAME IS REVERTED ONLY IF THE NAME IS STILL THE ONE THE DRAFT GAVE.
//
// A TEAM THE DRAFT MADE IS REMOVED ONLY IF IT IS EMPTY AND BARE. Deleting a team
// cascades away its check-in scores, its sheet marks and its photos, recordings
// and files — so it goes only when it ends up with nobody on it and none of
// those on it either, counted at the moment of the undo. A count that cannot be
// made keeps the team: guessing "nothing to lose" is the one wrong answer.

import {
  countOneTeamMarks,
  countOneTeamResults,
  deleteTeam,
  deleteTeamSet,
  moveStudents,
  renameTeam,
  setCurrentTeamSet,
} from "./data";
import { countResourcesForTeams } from "./resources";
import type { Student, TeamWithMembers } from "./types";

/** What a team change wrote, kept so it can be put back. */
export interface TeamChangeRecord {
  /** Each student moved: every team they were on before (empty: none), and where they went. */
  moved: { studentId: string; from: string[]; to: string }[];
  /** Teams it made. */
  created: { teamId: string; name: string }[];
  /** Teams it renamed: the name before, and the name it gave. */
  renamed: { teamId: string; from: string; to: string }[];
  /**
   * The change was a whole new team SET that the class was moved onto — the
   * assistant's "make new teams" — rather than moves within the current one.
   * Undo is then: put the class back on the set it was on, and remove the new
   * one while nothing has been recorded on it.
   */
  newSet?: { courseId: string; setId: string; name: string; previousSetId: string | null };
}

export interface TeamUndoPlan {
  /** Students to put back, and the teams they were on (empty: no team). */
  restore: { student: Student; to: string[] }[];
  /** Students left where they are, and why. */
  stayed: { name: string; why: string }[];
  renameBack: { teamId: string; to: string }[];
  /** Teams the draft made that end up empty — removed if nothing is filed on them. */
  remove: { teamId: string; name: string }[];
  /** Teams left as they are, and why. */
  kept: { name: string; why: string }[];
  /** Every team in the set now: moveStudents clears a student out of all of them. */
  teamIds: string[];
}

export interface TeamUndoOutcome {
  restored: number;
  renamedBack: number;
  removed: number;
  /** Everything that was not put back, one sentence each. */
  notes: string[];
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

function planStudents(record: TeamChangeRecord, roster: Student[], teams: TeamWithMembers[], keep: Set<string>) {
  const byId = new Map(roster.map((s) => [s.id, s]));
  const live = new Set(teams.map((t) => t.id));
  const onNow = (sid: string) => teams.filter((t) => t.members.some((m) => m.id === sid)).map((t) => t.id);
  const restore: TeamUndoPlan["restore"] = [];
  const stayed: TeamUndoPlan["stayed"] = [];
  for (const m of record.moved) {
    const student = byId.get(m.studentId);
    const now = onNow(m.studentId);
    // The caller is keeping them as they are, and says why itself.
    if (keep.has(m.studentId)) continue;
    if (!student) {
      stayed.push({ name: "a student", why: "is no longer on the roster" });
    } else if (sameIds(now, m.from)) {
      // Already back — a retry after an undo that failed part-way.
      continue;
    } else if (!sameIds(now, [m.to])) {
      stayed.push({ name: student.name, why: "has been moved since" });
    } else if (!m.from.every((id) => live.has(id))) {
      stayed.push({ name: student.name, why: "was on a team that has since been deleted" });
    } else {
      restore.push({ student, to: m.from });
    }
  }
  return { restore, stayed };
}

export function planTeamUndo(
  record: TeamChangeRecord,
  roster: Student[],
  teams: TeamWithMembers[],
  /** Students to leave exactly where they are — see importUndo.ts. */
  keep: Set<string> = new Set(),
): TeamUndoPlan {
  const { restore, stayed } = planStudents(record, roster, teams, keep);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const leaving = new Set(restore.map((r) => r.student.id));

  const renameBack: TeamUndoPlan["renameBack"] = [];
  const kept: TeamUndoPlan["kept"] = [];
  for (const r of record.renamed) {
    const t = byId.get(r.teamId);
    if (!t || t.name === r.from) continue;
    if (t.name === r.to) renameBack.push({ teamId: r.teamId, to: r.from });
    else kept.push({ name: t.name, why: "has been renamed again since, so it keeps that name" });
  }

  const remove: TeamUndoPlan["remove"] = [];
  for (const c of record.created) {
    const t = byId.get(c.teamId);
    if (!t) continue;
    const staying = t.members.filter((m) => !leaving.has(m.id));
    if (staying.length) kept.push({ name: t.name, why: "has people on it the draft did not put there, so it stays" });
    else remove.push({ teamId: t.id, name: t.name });
  }

  return { restore, stayed, renameBack, remove, kept, teamIds: teams.map((t) => t.id) };
}

/** Nothing filed on it that deleting it would destroy. Unsure counts as no. */
async function bare(teamId: string): Promise<boolean> {
  try {
    const [results, marks, files] = await Promise.all([
      countOneTeamResults(teamId),
      countOneTeamMarks(teamId),
      countResourcesForTeams([teamId]),
    ]);
    return results === 0 && marks === 0 && files === 0;
  } catch {
    return false;
  }
}

/**
 * Undo a new set: switch the class back, then delete the set if it is bare.
 *
 * Switching back comes first and always happens — that is the undo she asked
 * for. The delete is the part that could cost something, so it is checked team
 * by team, and a set with anything recorded on it stays (out of use) with a
 * sentence saying why.
 */
export async function undoNewSet(record: TeamChangeRecord): Promise<TeamUndoOutcome & { switchedBack: boolean }> {
  const ns = record.newSet;
  if (!ns) throw new Error("This change did not make a new team set.");
  if (ns.previousSetId) await setCurrentTeamSet(ns.courseId, ns.previousSetId);
  const recorded: string[] = [];
  for (const t of record.created) if (!(await bare(t.teamId))) recorded.push(t.name);
  if (recorded.length) {
    return {
      restored: 0,
      renamedBack: 0,
      removed: 0,
      switchedBack: Boolean(ns.previousSetId),
      notes: [
        `Something has been recorded on ${recorded.join(", ")} since, so "${ns.name}" was kept — ` +
          "no longer in use. Delete it on Teams if you do not need it.",
      ],
    };
  }
  await deleteTeamSet(ns.setId);
  return { restored: 0, renamedBack: 0, removed: record.created.length, switchedBack: Boolean(ns.previousSetId), notes: [] };
}

/** Put students back, then names, then remove the new teams that are empty and bare. */
export async function applyTeamUndo(plan: TeamUndoPlan): Promise<TeamUndoOutcome> {
  // One write per team they go back to, not one per student: a whole class
  // formed afresh comes back in a handful of calls. Out of every team in the
  // set, onto the team they were on — or onto none, where a student who had no
  // team before goes back to.
  const byTeam = new Map<string | null, string[]>();
  for (const { student, to } of plan.restore) {
    const key = to[0] ?? null;
    byTeam.set(key, [...(byTeam.get(key) ?? []), student.id]);
  }
  for (const [teamId, ids] of byTeam) await moveStudents(ids, teamId, plan.teamIds);
  // Somebody who was on two teams goes back on both. Insert only.
  for (const { student, to } of plan.restore) {
    for (const extra of to.slice(1)) await moveStudents([student.id], extra, []);
  }
  for (const r of plan.renameBack) await renameTeam(r.teamId, r.to);

  const notes = [
    ...plan.stayed.map((s) => `${s.name} ${s.why}, so was left where they are.`),
    ...plan.kept.map((k) => `${k.name} ${k.why}.`),
  ];
  let removed = 0;
  for (const t of plan.remove) {
    if (await bare(t.teamId)) {
      await deleteTeam(t.teamId);
      removed++;
    } else {
      notes.push(
        `${t.name} has a check-in score, a mark or a file on it now, so it was left in place, empty. ` +
          "Delete it on Form teams if you no longer need it.",
      );
    }
  }
  return { restored: plan.restore.length, renamedBack: plan.renameBack.length, removed, notes };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function teamUndoText(out: TeamUndoOutcome): string {
  const parts = [
    out.restored ? `moved ${plural(out.restored, "student", "students")} back` : "",
    out.renamedBack ? `renamed ${plural(out.renamedBack, "team", "teams")} back` : "",
    out.removed ? `removed ${plural(out.removed, "team", "teams")} it made` : "",
  ].filter(Boolean);
  return parts.length ? `Undone — ${parts.join(", ")}.` : "Nothing was left to undo.";
}
