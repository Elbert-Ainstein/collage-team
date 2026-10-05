// Undoing a class-list import on Roster & teams.
//
// An import does four things in one press — adds the students who are not on
// the roster, fills in the addresses rows were missing, corrects names the file
// spells differently, and seats everyone — so Undo takes back all four, each
// only while it is still the way the import left it. The seating half is
// teamUndo.ts, shared with the assistant; this adds the roster half.
//
// THE ROSTER HALF IS THE DANGEROUS HALF. Removing a row removes the student and
// everything of theirs, so a student the import added is taken off again only
// if all of these hold, checked at the moment of the undo:
//   - nobody has signed in as them (the row is unclaimed);
//   - they have not been put on a team by hand since;
//   - they have handed in nothing — and a count that cannot be made is "no".
// Anyone else stays — on the roster AND on whatever team they are on, so the
// undo never leaves them half taken back — and the result says who and why.
//
// An address goes back to blank only while it is the one the import filled in
// and nobody has signed in with it; a name goes back only while it is the one
// the import wrote.

import { removeStudentWithStorage } from "@/checkins/purge";
import { setStudentEmail, setStudentName } from "@/checkins/data";
import type { TeamPlanRecord } from "@/checkins/teamImport";
import {
  applyTeamUndo,
  planTeamUndo,
  type TeamChangeRecord,
  type TeamUndoOutcome,
  type TeamUndoPlan,
} from "@/checkins/teamUndo";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { countWorkForStudent } from "@/faculty/facultyData";

export interface ImportRecord {
  teams: TeamChangeRecord;
  added: { studentId: string; name: string }[];
  emails: { studentId: string; from: string | null; to: string }[];
  names: { studentId: string; from: string; to: string }[];
}

export interface ImportUndoPlan {
  teams: TeamUndoPlan;
  /** Students the import added who may be taken off again (work is counted at apply). */
  remove: Student[];
  emailsBack: { student: Student; to: string | null }[];
  namesBack: { student: Student; to: string }[];
  /** What is being left alone, and why — known before anything is written. */
  notes: string[];
}

export interface ImportUndoOutcome {
  teams: TeamUndoOutcome;
  removed: number;
  namesBack: number;
  emailsBack: number;
  notes: string[];
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** What an import wrote, from what it was handed and what it handed back. */
export function importRecord(input: {
  /** The teams as they were before the press. */
  before: TeamWithMembers[];
  added: Student[];
  emails: { student: Student; email: string }[];
  names: { student: Student; to: string }[];
  /** Null when the import placed nobody. */
  teams: TeamPlanRecord | null;
}): ImportRecord {
  const wasOn = (sid: string) => input.before.filter((t) => t.members.some((m) => m.id === sid)).map((t) => t.id);
  const placed = input.teams?.placed ?? [];
  return {
    teams: {
      // A student "placed" on the team they were already on was not moved, and
      // has nothing to be put back.
      moved: placed
        .map((p) => ({ studentId: p.studentId, from: wasOn(p.studentId), to: p.to }))
        .filter((m) => !sameIds(m.from, [m.to])),
      created: input.teams?.created ?? [],
      renamed: input.teams?.renamed ?? [],
    },
    added: input.added.map((s) => ({ studentId: s.id, name: s.name })),
    emails: input.emails.map((e) => ({ studentId: e.student.id, from: e.student.email, to: e.email })),
    names: input.names.map((n) => ({ studentId: n.student.id, from: n.student.name, to: n.to })),
  };
}

/** Why an added student stays on the roster, by id. Work is counted by undoImport. */
export type Staying = Map<string, "work" | "unknown">;

/** Added students who stay, and the sentence for each. */
function keepers(record: ImportRecord, byId: Map<string, Student>, work: Staying) {
  const keep = new Set<string>();
  const notes: string[] = [];
  for (const a of record.added) {
    const s = byId.get(a.studentId);
    if (!s) continue;
    const why = s.user_id
      ? `${s.name} has signed in since, so stays on the roster.`
      : work.get(s.id) === "work"
        ? `${s.name} has handed in work since, so stays on the roster.`
        : work.get(s.id) === "unknown"
          ? `${s.name}'s work could not be checked just now, so they stay on the roster.`
          : null;
    if (why) {
      keep.add(s.id);
      notes.push(why);
    }
  }
  return { keep, notes };
}

export function planImportUndo(
  record: ImportRecord,
  roster: Student[],
  teams: TeamWithMembers[],
  work: Staying = new Map(),
): ImportUndoPlan {
  const byId = new Map(roster.map((s) => [s.id, s]));
  const { keep, notes } = keepers(record, byId, work);
  const plan = planTeamUndo(record.teams, roster, teams, keep);
  const goingBack = new Set(plan.restore.map((r) => r.student.id));
  const onATeam = (sid: string) => teams.some((t) => t.members.some((m) => m.id === sid));
  // Off the roster only if leaving their team too, or on none already — one put
  // on a team by hand since is in teamUndo's notes, and stays.
  const remove = record.added
    .map((a) => byId.get(a.studentId))
    .filter((s): s is Student => Boolean(s) && !keep.has((s as Student).id))
    .filter((s) => goingBack.has(s.id) || !onATeam(s.id));

  const emailsBack: ImportUndoPlan["emailsBack"] = [];
  for (const e of record.emails) {
    const s = byId.get(e.studentId);
    if (!s) continue;
    if ((s.email ?? "").toLowerCase() !== e.to.toLowerCase()) notes.push(`${s.name}'s address has been changed since, so it stays.`);
    else if (s.user_id) notes.push(`${s.name}'s address stays: they have signed in with it.`);
    else emailsBack.push({ student: s, to: e.from });
  }

  const namesBack: ImportUndoPlan["namesBack"] = [];
  for (const n of record.names) {
    const s = byId.get(n.studentId);
    if (!s) continue;
    if (s.name === n.to) namesBack.push({ student: s, to: n.from });
    else notes.push(`${s.name} has been renamed since, so keeps that name.`);
  }

  return { teams: plan, remove, emailsBack, namesBack, notes };
}

/** Seats first, then names and addresses, then the students it added. */
async function applyImportUndo(plan: ImportUndoPlan): Promise<ImportUndoOutcome> {
  const teams = await applyTeamUndo(plan.teams);
  for (const n of plan.namesBack) await setStudentName(n.student.id, n.to);
  for (const e of plan.emailsBack) await setStudentEmail(e.student.id, e.to);
  for (const s of plan.remove) await removeStudentWithStorage(s.id);
  return {
    teams,
    removed: plan.remove.length,
    namesBack: plan.namesBack.length,
    emailsBack: plan.emailsBack.length,
    notes: [...plan.notes, ...teams.notes],
  };
}

/**
 * Count, then plan, then write. The work count comes FIRST because it decides
 * the plan: a student who stays on the roster keeps their team, and a team with
 * them still on it is not empty and is not removed.
 */
export async function undoImport(
  record: ImportRecord,
  roster: Student[],
  teams: TeamWithMembers[],
): Promise<ImportUndoOutcome> {
  const unclaimed = record.added
    .map((a) => roster.find((s) => s.id === a.studentId))
    .filter((s): s is Student => Boolean(s) && !(s as Student).user_id);
  const work: Staying = new Map();
  await Promise.all(
    unclaimed.map(async (s) => {
      try {
        if ((await countWorkForStudent(s.id)) > 0) work.set(s.id, "work");
      } catch {
        // Unsure is not "nothing": a row with work on it cannot be brought back.
        work.set(s.id, "unknown");
      }
    }),
  );
  return applyImportUndo(planImportUndo(record, roster, teams, work));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function importUndoText(out: ImportUndoOutcome): string {
  const t = out.teams;
  // Students the import added go back to "no team" on the way out; they are
  // counted as removed, not as moved back.
  const movedBack = Math.max(0, t.restored - out.removed);
  const parts = [
    out.removed ? `removed ${plural(out.removed, "student", "students")} it added` : "",
    movedBack ? `moved ${plural(movedBack, "student", "students")} back` : "",
    t.removed ? `removed ${plural(t.removed, "team", "teams")} it made` : "",
    t.renamedBack ? `renamed ${plural(t.renamedBack, "team", "teams")} back` : "",
    out.namesBack ? `put back ${plural(out.namesBack, "name", "names")}` : "",
    out.emailsBack ? `cleared ${plural(out.emailsBack, "address", "addresses")} it filled in` : "",
  ].filter(Boolean);
  if (!parts.length) return "Nothing was left to undo.";
  return `Import undone — ${parts.join(", ")}.`;
}
