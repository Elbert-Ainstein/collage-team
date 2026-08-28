// Turning a file's team numbers into teams.
//
// parseRoster reads the third column Kelly asked for — names, emails, a number
// that says which team. This module is what that number MEANS, and that is the
// whole of the job: which student a row is about, and what happens to the teams
// that are already there.
//
// Four decisions, kept here rather than on the screen so they are stated once
// and can be tested.
//
// MATCHING is email first, name second, and a name that could be two people is
// refused rather than guessed. Email is the only field that is really unique —
// it is what a student signs in with — but a spreadsheet kept by hand may not
// have one at all, so a name has to be enough on its own. A roster row may be
// claimed by ONE file row only: two classmates who share a name do not collapse
// into a single person, and the second row says so instead of taking whichever
// row came back first. That is the same rule rosterReconcile applies for the
// same reason, and it is written twice because that one answers a different
// question — add this person, or fill in their address — and answering "which
// student is this" through it would mean reading the answer out of `fresh`,
// which is the list of people it did NOT identify.
//
// A ROW THAT MATCHES NOBODY CREATES NOBODY. The file carries names and
// addresses, so it could — but students now arrive on their own by class code,
// so the roster fills itself, and in a class that is already full a row nothing
// matches is far more likely to be a spelling than a new student. Creating them
// here would also put a row on a team that no account will ever claim, which is
// the roster state the instructor can see least and the app can repair least.
// So those rows are named in the preview, nothing moves for them, and the way
// to add them is the roster import in the same panel — after which the file
// matches and can be imported again.
//
// ANYONE THE FILE DOES NOT MENTION KEEPS THE TEAM THEY ARE ON. A file is a
// statement about the students in it, not about the class. The late enrolment
// who joined by code after the spreadsheet was exported is missing from it, and
// pulling that person off their team is the half of this that a corrected file
// cannot undo — their team is where their photos and their team's recording
// are. A blank team cell is read the same way, and so is a row whose team is
// not a number: parseRoster has already reported those, and this leaves them
// where they are.
//
// NOTHING IS DELETED. Re-forming teams DROPS the team rows: check_in_results
// and team_resources cascade from teams and storage does not cascade at all,
// which is why deleteTeamResourceObjects and deleteTeamStorage exist and why
// TeamsPillar counts scores and photos before it dares. This import never needs
// any of that. Every file can be expressed as members MOVING between the teams
// that already exist, plus a new team for a number that has none — and moving
// members writes to team_members alone, so every whiteboard photo, every team
// recording and every recorded team score survives it. There is no destructive
// confirmation here because there is nothing to confirm. An existing team the
// file empties is left standing for the same reason: emptying it costs nothing,
// deleting it costs everything filed against it, and that delete already has a
// guard on the Form teams screen.

import { createTeam, createTeamSet, listTeamSets, moveStudents, renameTeam } from "./data";
import type { ParsedStudent } from "./rosterImport";
import type { Student, TeamWithMembers } from "./types";

/** Why a row carrying a team number could not be put on one. */
export type MissReason = "not-on-roster" | "ambiguous" | "already-matched";

export interface UnplacedRow {
  row: ParsedStudent;
  why: MissReason;
  /** Who the row could have meant. Empty for "not-on-roster". */
  candidates: string[];
}

export interface Placement {
  student: Student;
  team: number;
  /** Which field identified them — the preview says how many came in by name. */
  by: "email" | "name";
}

export interface PlannedTeam {
  /** The number the file used. Null for a team the file never mentions. */
  number: number | null;
  /**
   * What it will be called afterwards — always "Team <the file's number>". The
   * file is what says who is on which team, so it is also what says which team
   * this is; a team called Team Helix while the spreadsheet says 3 leaves the
   * two disagreeing about the same group of people.
   */
  name: string;
  /** What it is called today, so the preview can show a rename before it happens. */
  currentName: string | null;
  /** The team row this lands on, when there is one to land on. */
  existingId: string | null;
  /** Everyone the file puts here. */
  moved: Student[];
  /** Members the file does not mention, who stay. */
  kept: Student[];
  /** moved + kept, in roster order — who is on this team afterwards. */
  members: Student[];
  /** Has members today and none afterwards. Left standing; see the top of the file. */
  emptied: boolean;
}

export interface TeamPlan {
  /** The set being written into, when the screen already knows which one. */
  setId: string | null;
  /** Where a new team's position starts, so created teams sort after the rest. */
  nextPosition: number;
  /** The biggest team in the file — only used to size a set created from nothing. */
  size: number;
  teams: PlannedTeam[];
  placements: Placement[];
  unplaced: UnplacedRow[];
  /** Matched rows whose team cell was blank or unreadable. They stay put. */
  noNumber: ParsedStudent[];
  /** Roster students the file does not mention at all. They stay put. */
  notInFile: Student[];
}

export interface TeamImportOutcome {
  /** Teams the file renamed, because its number is what a team is called. */
  renamed: number;
  /** Null only when the plan placed nobody and nothing was written. */
  setId: string | null;
  /** Teams created for a number that had none. */
  created: number;
  /** Students the file actually placed. */
  moved: number;
}

/** The two rules the screen has to say out loud, worded once. */
export const KEEPS_THEIR_TEAM =
  "Anyone the file does not mention keeps the team they are on now — nobody is taken off a team.";

export const NOTHING_IS_DELETED =
  "No team is deleted, so no whiteboard photo, team recording or recorded team score goes. " +
  "Students move between the teams that are already there, and a number with no team yet gets a new one.";

/** Does this file say anything about teams at all? */
export function hasTeamNumbers(rows: ParsedStudent[]): boolean {
  return rows.some((r) => typeof r.team === "number");
}

const norm = (s: string) => s.trim().toLowerCase();

/** A roster row as the preview has to name it when two of them collide. */
function describe(s: Student): string {
  return s.email ? `${s.name} (${s.email})` : `${s.name} (no address)`;
}

function label(row: ParsedStudent): string {
  return row.email ? `${row.name} (${row.email})` : row.name;
}

/** The sentence for one row nothing was moved for. */
export function missReason(u: UnplacedRow): string {
  switch (u.why) {
    case "not-on-roster":
      return `${label(u.row)} is not on the roster, so nothing was moved for this row. Add them above, then import the file again.`;
    case "ambiguous":
      return `${u.row.name} could be ${u.candidates.join(" or ")} — the file does not say which, so neither was moved. Put their addresses in the file, or tell them apart on the roster.`;
    case "already-matched":
      return `${label(u.row)} appears twice in the file: an earlier row already matched ${u.candidates[0]}, so this one was skipped. Only one of the two teams can be right.`;
  }
}

function push<T>(m: Map<string, T[]>, key: string, value: T): void {
  const at = m.get(key);
  if (at) at.push(value);
  else m.set(key, [value]);
}

interface Matched {
  hits: Map<ParsedStudent, { student: Student; by: "email" | "name" }>;
  misses: Map<ParsedStudent, UnplacedRow>;
}

/**
 * Which roster row each file row is about.
 *
 * Two passes, and the order is the point: settling every email match before any
 * name match is what stops a name from taking a row that an address elsewhere
 * in the file has already identified. `claimed` is what stops one roster row
 * being handed two different teams.
 */
function matchRows(roster: Student[], rows: ParsedStudent[]): Matched {
  const hits: Matched["hits"] = new Map();
  const misses: Matched["misses"] = new Map();
  const claimed = new Set<string>();

  const byEmail = new Map<string, Student[]>();
  const byName = new Map<string, Student[]>();
  for (const s of roster) {
    if (s.email) push(byEmail, norm(s.email), s);
    push(byName, norm(s.name), s);
  }

  const settle = (row: ParsedStudent, found: Student[], by: "email" | "name"): void => {
    const free = found.filter((s) => !claimed.has(s.id));
    if (!free.length) {
      // Everyone this row could be has already been taken by an earlier row —
      // which is the file naming the same person twice, on two teams.
      misses.set(row, { row, why: "already-matched", candidates: found.map((s) => s.name) });
      return;
    }
    if (free.length > 1) {
      misses.set(row, { row, why: "ambiguous", candidates: free.map(describe) });
      return;
    }
    claimed.add(free[0].id);
    hits.set(row, { student: free[0], by });
  };

  const settled = new Set<ParsedStudent>();
  for (const row of rows) {
    const found = row.email ? (byEmail.get(norm(row.email)) ?? []) : [];
    // No address match is not a refusal — the roster row may simply have no
    // address on it yet, which is most of a roster that filled itself.
    if (!found.length) continue;
    settle(row, found, "email");
    settled.add(row);
  }
  for (const row of rows) {
    if (settled.has(row)) continue;
    const found = byName.get(norm(row.name)) ?? [];
    if (!found.length) {
      misses.set(row, { row, why: "not-on-roster", candidates: [] });
      continue;
    }
    settle(row, found, "name");
  }

  return { hits, misses };
}

/**
 * A number inside a team's name. "Team 3" and "3" are 3; "Team Helix" is not a
 * number at all, and neither is "Fall 2024" — nothing under a hundred is in it.
 */
const NUMBER_IN_NAME = /(?:^|\D)(\d{1,6})(?:\D|$)/;

function numberInName(name: string): number | null {
  const m = NUMBER_IN_NAME.exec(name);
  return m ? Number(m[1]) : null;
}

const byPosition = (a: TeamWithMembers, b: TeamWithMembers) => a.position - b.position;

/**
 * Which existing team each of the file's numbers lands on.
 *
 * A team whose name already says a number is only ever matched to THAT number —
 * a team called "Team 9" must not quietly become team 1 because 1 came first in
 * the file. Everything else is matched in order: a set auto-formed as Helix,
 * Ribosome, Vesicle has no numbers anywhere, and the file's 1, 2, 3 are those
 * three teams in the order they sit on the screen. Either way the row keeps its
 * name — the number identifies the team, the name is the instructor's.
 *
 * A number left over after that has no team yet and gets a new one.
 */
function bindNumbers(
  numbers: number[],
  existing: TeamWithMembers[],
): Map<number, TeamWithMembers | null> {
  const inOrder = [...existing].sort(byPosition);
  const named = new Map<number, TeamWithMembers>();
  const spare: TeamWithMembers[] = [];
  for (const t of inOrder) {
    const n = numberInName(t.name);
    if (n == null) {
      spare.push(t);
      continue;
    }
    // A second team saying the same number cannot be bound to it, and must not
    // fall into the spares either — it still says which number it is.
    if (!named.has(n)) named.set(n, t);
  }

  const bound = new Map<number, TeamWithMembers | null>();
  let next = 0;
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const hit = named.get(n);
    if (hit) {
      bound.set(n, hit);
      continue;
    }
    bound.set(n, spare[next] ?? null);
    if (spare[next]) next++;
  }
  return bound;
}

export function planTeamImport(input: {
  roster: Student[];
  rows: ParsedStudent[];
  teams: TeamWithMembers[];
}): TeamPlan {
  const { roster, rows, teams } = input;
  const { hits, misses } = matchRows(roster, rows);

  const placements: Placement[] = [];
  const noNumber: ParsedStudent[] = [];
  const mentioned = new Set<string>();
  for (const row of rows) {
    const hit = hits.get(row);
    if (!hit) continue;
    mentioned.add(hit.student.id);
    if (typeof row.team !== "number") {
      noNumber.push(row);
      continue;
    }
    placements.push({ student: hit.student, team: row.team, by: hit.by });
  }

  // Only rows that were actually trying to place someone. A row with no team
  // number that matched nobody is the roster import's business, not this one's,
  // and listing it here would be the same complaint twice on one screen.
  const unplaced: UnplacedRow[] = [];
  for (const row of rows) {
    const miss = misses.get(row);
    if (miss && typeof row.team === "number") unplaced.push(miss);
  }

  const placed = new Set(placements.map((p) => p.student.id));
  const inRosterOrder = (a: Student, b: Student) => a.position - b.position;

  const numbers = [...new Set(placements.map((p) => p.team))].sort((a, b) => a - b);
  const bound = bindNumbers(numbers, teams);
  const takenIds = new Set(
    [...bound.values()].filter((t): t is TeamWithMembers => Boolean(t)).map((t) => t.id),
  );

  const build = (
    number: number | null,
    existing: TeamWithMembers | null,
    moved: Student[],
  ): PlannedTeam => {
    // Members who are not placed anywhere stay exactly where they are, whether
    // the file forgot them or left their team cell blank.
    const kept = existing ? existing.members.filter((m) => !placed.has(m.id)) : [];
    const members = [...moved, ...kept].sort(inRosterOrder);
    return {
      number,
      // The NUMBER in the file names the team, even when the team it binds to
      // is called something else today. The file is the source of truth for who
      // is on which team, and a plan that moved everybody into "Team Helix"
      // while the spreadsheet said 3 would leave the two disagreeing about the
      // same team forever. Re-importing the same file therefore always produces
      // the same names, rather than depending on what happened in between.
      name: number == null ? (existing?.name ?? "Unassigned") : `Team ${number}`,
      currentName: existing?.name ?? null,
      existingId: existing?.id ?? null,
      moved,
      kept,
      members,
      emptied: Boolean(existing && existing.members.length > 0 && members.length === 0),
    };
  };

  const planned: PlannedTeam[] = numbers.map((n) =>
    build(
      n,
      bound.get(n) ?? null,
      placements
        .filter((p) => p.team === n)
        .map((p) => p.student)
        .sort(inRosterOrder),
    ),
  );
  // The teams the file says nothing about, after the ones it does — the preview
  // has to show them, because members of theirs may be leaving.
  for (const t of [...teams].sort(byPosition)) {
    if (!takenIds.has(t.id)) planned.push(build(null, t, []));
  }

  return {
    setId: teams[0]?.team_set_id ?? null,
    nextPosition: teams.reduce((n, t) => Math.max(n, t.position), -1) + 1,
    size: Math.max(2, ...planned.map((t) => t.members.length)),
    teams: planned,
    placements,
    unplaced,
    noNumber,
    notInFile: roster.filter((s) => !mentioned.has(s.id)),
  };
}

/**
 * The set to write into, when the screen is not already showing one.
 *
 * Deliberately the same choice FacultyApp makes when it loads `teams` — a
 * course-wide set, else the newest. The roster screen prints each student's
 * team from THAT set, so an import that wrote anywhere else would look like it
 * had silently done nothing.
 */
async function targetSet(courseId: string, plan: TeamPlan): Promise<string> {
  const sets = await listTeamSets(courseId);
  const set = sets.find((s) => s.activity_id == null) ?? sets[sets.length - 1] ?? null;
  if (set) return set.id;
  const made = await createTeamSet({
    courseId,
    activityId: null,
    name: `Whole session · teams of ${plan.size}`,
    teamSize: plan.size,
  });
  return made.id;
}

/**
 * Write the plan: create the teams a number has none for, then move members.
 *
 * Safe to run twice. Nothing here deletes a team, and the second run finds the
 * teams it made the first time by name and moves the same people into the same
 * places — so a run that dies halfway can simply be repeated, which is the only
 * recovery a browser-only app can offer.
 */
export async function applyTeamPlan(
  courseId: string,
  plan: TeamPlan,
): Promise<TeamImportOutcome> {
  // A file that matched nobody has nothing to write, and going on would leave a
  // brand-new empty team set behind as the only trace of an import that did
  // nothing.
  if (!plan.placements.length) return { setId: plan.setId, created: 0, renamed: 0, moved: 0 };

  const setId = plan.setId ?? (await targetSet(courseId, plan));

  // Every team in the set, including the ones the file never names. This is
  // what moveStudents clears a student out of, so a team missing from this list
  // keeps members the file has just put somewhere else — and a student on two
  // teams at once is a student who gets checked in twice.
  const ids = plan.teams
    .map((t) => t.existingId)
    .filter((id): id is string => Boolean(id));

  const targets: { team: PlannedTeam; id: string }[] = [];
  let position = plan.nextPosition;
  let created = 0;
  let renamed = 0;
  for (const team of plan.teams) {
    if (team.existingId) {
      // The file names it. A team bound to number 3 becomes "Team 3" even if it
      // is called Team Helix today, so that the spreadsheet and the screen never
      // disagree about the same team — and so that re-importing the same file
      // always lands in the same place rather than depending on what it was
      // called in between.
      if (team.currentName !== team.name) {
        await renameTeam(team.existingId, team.name);
        renamed++;
      }
      targets.push({ team, id: team.existingId });
      continue;
    }
    // A number nothing was placed on is not a team, it is a gap in the file's
    // numbering — creating it would leave an empty team on the screen.
    if (!team.moved.length) continue;
    const row = await createTeam(setId, team.name, position++);
    created++;
    ids.push(row.id);
    targets.push({ team, id: row.id });
  }

  let moved = 0;
  for (const { team, id } of targets) {
    if (!team.moved.length) continue;
    await moveStudents(team.moved.map((s) => s.id), id, ids);
    moved += team.moved.length;
  }

  return { setId, created, renamed, moved };
}
