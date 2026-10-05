// From form_teams settings to a draft the app can apply.
//
// Four steps, all in the browser: check every column the model named against
// the real file (it saw only a summary), join the file to the roster, form the
// teams in code (formTeams.ts), and say where each new team lands. The result
// is an ordinary seat draft, so Apply and Undo go through seating.ts and
// teamUndo.ts like every other change — nothing about forming teams needs a
// write path of its own.
//
// WHERE THE NEW TEAMS LAND. On the team rows that already exist, in order, and
// on new rows only for teams beyond them. A row a student moves onto keeps its
// name and everything filed against it; a row left with nobody stays standing,
// as the importer leaves it. Nothing is deleted.

import type { FormProposal, SeatProposal } from "@/assistant/types";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { formTeams, type FormResult, type Person } from "./formTeams";
import type { Refs } from "./snapshot";
import { findColumn, findValue, joinRoster, valuesIn, type Table } from "./table";

export interface FormPlan {
  /** Anything that keeps the teams from being formed at all. */
  problems: string[];
  /** What the file and the roster disagree about — formed anyway, said out loud. */
  notes: string[];
  result: FormResult | null;
  /** Where each formed team lands: an existing row, or a new team by name. */
  targets: { name: string; teamId: string | null }[];
  /** The formed teams as a seat draft, refs being row ids (see `refs`). */
  proposal: SeatProposal;
  refs: Refs;
}

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

function preview(names: string[], max = 6): string {
  return names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", ");
}

/** Every column the settings name, found in the real file — or why not. */
function resolve(p: FormProposal, table: Table | null) {
  const problems: string[] = [];
  const named = [...p.balance.map((b) => b.column), ...p.avoidColumns, ...p.nameColumns, ...(p.emailColumn ? [p.emailColumn] : [])];
  if (named.length && !table) {
    return { problems: ["These rules need the class spreadsheet, and none is attached. Attach it and ask again."], cols: null };
  }
  const find = (c: string) => {
    const hit = table ? findColumn(table, c) : null;
    if (!hit) problems.push(`The file has no column called "${c}".`);
    return hit ?? c;
  };
  // Every value a category rule names must be one the column holds. One that
  // is not would be ignored by the team-former while its check still showed a
  // tick — a rule dropped in silence, which this whole path exists to prevent.
  const value = (column: string, wanted: string) => {
    const holds = table ? valuesIn(table, column) : [];
    const hit = findValue(holds, wanted);
    if (!hit && table?.headers.includes(column)) {
      const shown = holds.length > 8 ? `${holds.slice(0, 8).join(", ")}, …` : holds.join(", ");
      problems.push(`The "${column}" column has no value "${wanted}" — it holds ${shown || "nothing"}.`);
    }
    return hit ?? wanted;
  };
  const cols = {
    balance: p.balance.map((b) => {
      const column = find(b.column);
      return { column, kind: b.kind, values: b.kind === "category" ? b.values.map((v) => value(column, v)) : [] };
    }),
    avoid: p.avoidColumns.map(find),
    name: p.nameColumns.map(find),
    email: p.emailColumn ? find(p.emailColumn) : null,
  };
  if (table && named.length && !cols.name.length && !cols.email) {
    problems.push("It is not clear which column of the file holds each student's name or email.");
  }
  return { problems, cols };
}

/** Existing rows first, in screen order; then "Team N" names nothing else has. */
function targetsFor(count: number, teams: TeamWithMembers[]): FormPlan["targets"] {
  const existing = [...teams].sort(byPosition);
  const taken = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  let n = existing.length;
  return Array.from({ length: count }, (_, i) => {
    if (existing[i]) return { name: existing[i].name, teamId: existing[i].id };
    do n++;
    while (taken.has(`team ${n}`));
    taken.add(`team ${n}`);
    return { name: `Team ${n}`, teamId: null };
  });
}

export function planForm(
  p: FormProposal,
  table: Table | null,
  roster: Student[],
  teams: TeamWithMembers[],
  seed: number,
): FormPlan {
  const refs: Refs = {
    students: new Map(roster.map((s) => [s.id, s.id])),
    teams: new Map(teams.map((t) => [t.id, t.id])),
  };
  const empty: SeatProposal = { kind: "seat", summary: p.summary, moves: [], renames: [], unresolved: [] };
  const { problems, cols } = resolve(p, table);
  if (problems.length || !cols) return { problems, notes: [], result: null, targets: [], proposal: empty, refs };

  const notes: string[] = [];
  let people: Person[] = roster.map((s) => ({ id: s.id, values: {} }));
  if (table && (cols.name.length || cols.email)) {
    const j = joinRoster(table, { email: cols.email, name: cols.name }, roster);
    people = j.people;
    if (j.missing.length) {
      notes.push(`${preview(j.missing.map((s) => s.name))} ${j.missing.length === 1 ? "is" : "are"} on the roster but not in the file — placed without their details.`);
    }
    if (j.unmatched.length) {
      notes.push(`${preview(j.unmatched)} ${j.unmatched.length === 1 ? "is" : "are"} in the file but on nobody's roster row — left out. Add them on Roster & teams first.`);
    }
    if (j.ambiguous.length) {
      notes.push(`${preview(j.ambiguous)} could be more than one student — left without details. Add their emails to the file.`);
    }
  }

  const currentTeam = new Map<string, string>();
  for (const t of teams) for (const m of t.members) if (!currentTeam.has(m.id)) currentTeam.set(m.id, t.id);
  const result = formTeams({
    people,
    currentTeam,
    seed,
    spec: { teamSize: p.teamSize, avoidCurrent: p.avoidCurrent, avoidColumns: cols.avoid, balance: cols.balance },
  });
  const targets = targetsFor(result.teams.length, teams);
  const proposal: SeatProposal = {
    ...empty,
    moves: result.teams.flatMap((t, i) =>
      t.members.map((id) => ({
        student: id,
        toTeam: targets[i].teamId,
        toNewTeam: targets[i].teamId ? null : targets[i].name,
      })),
    ),
  };
  return { problems: [], notes, result, targets, proposal, refs };
}
