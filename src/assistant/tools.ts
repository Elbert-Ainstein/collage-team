// The two things the assistant may propose, and the check on what comes back.
//
// Both are PROPOSALS. Calling one writes nothing; it hands the browser a
// draft, and the browser shows it and waits for the instructor. That is why
// there is no delete tool, no "remove from team" and no roster wipe here: the
// app already guards each of those with a counted, twice-asked confirmation on
// the screen that owns it, and a chat box is the wrong place to grow a second,
// weaker way in.
//
// The schemas use only what every function-calling API accepts (objects,
// arrays, strings, integers, enums — no oneOf), so the same specs can be handed
// to another provider later. "Exactly one of to_team / to_new_team" is
// therefore enforced here rather than in the schema.

import type { ImportRow, Proposal, SeatMove } from "./types";

/** A tool as any provider needs it: a name, when to use it, and its input. */
export interface ToolSpec {
  name: string;
  description: string;
  schema: { type: "object"; properties: Record<string, unknown>; required: string[] };
}

/** The longest name a team can be given here. The longest real one is ~20. */
export const MAX_TEAM_NAME = 80;
const MAX_SUMMARY = 600;
const MAX_ENTRIES = 2000;
const MAX_TEAM_NUMBER = 999_999;

const SUMMARY = {
  type: "string",
  description:
    "One or two plain sentences for the instructor saying what this changes, e.g. " +
    "\"Moves Ada Lovelace to Team 3 and starts a new Team 7 for the two late joiners.\"",
};

export const SEAT_STUDENTS: ToolSpec = {
  name: "seat_students",
  description:
    "Draft targeted team changes: move named students onto existing teams (by team ref) or onto " +
    "new teams (by name), and rename teams. Use this for instructions like 'move Ada to team 3', " +
    "'swap Ada and Alan', 'split team 5 across the others', 'make a team called Helix with these " +
    "four', and for lists whose teams are NAMES rather than numbers. Students must be on the " +
    "roster — refer to them only by their ref. Students you do not move stay where they are. " +
    "Nothing is written until the instructor presses Apply on the preview.",
  schema: {
    type: "object",
    properties: {
      summary: SUMMARY,
      moves: {
        type: "array",
        description:
          "One entry for EVERY student the request places — including students who are already " +
          "on that team. Do not work out who changes; the app drops moves that change nothing. " +
          "Give exactly one of to_team or to_new_team.",
        items: {
          type: "object",
          properties: {
            student: { type: "string", description: "The student's ref, e.g. \"s12\"." },
            to_team: { type: "string", description: "An existing team's ref, e.g. \"t3\"." },
            to_new_team: {
              type: "string",
              description: "The name of a team to create, e.g. \"Team 7\". Use the same name for everyone joining it.",
            },
          },
          required: ["student"],
        },
      },
      renames: {
        type: "array",
        description: "Existing teams to give a new name.",
        items: {
          type: "object",
          properties: {
            team: { type: "string", description: "The team's ref." },
            name: { type: "string", description: "Its new name." },
          },
          required: ["team", "name"],
        },
      },
      unresolved: {
        type: "array",
        description:
          "Anything the instructor named that you could not pin to exactly one student on the " +
          "roster — not on it, or could be two people. Do not guess; list it here instead.",
        items: {
          type: "object",
          properties: {
            entry: { type: "string", description: "What the instructor wrote, e.g. \"Jon S.\"." },
            reason: { type: "string", description: "Why it was not matched, in one sentence." },
          },
          required: ["entry", "reason"],
        },
      },
    },
    required: ["summary", "moves"],
  },
};

export const PREPARE_IMPORT: ToolSpec = {
  name: "prepare_import",
  description:
    "Rewrite a class list the instructor pasted — any format: CSV, columns copied from a " +
    "spreadsheet, 'Team 1: Ada, Alan' lines — as rows of name, email and team NUMBER for the " +
    "Teams screen's importer. The importer adds anyone not yet on the roster and seats everyone " +
    "on the team their number says, and shows its own preview before writing. Use this whenever " +
    "the instructor gives a list of students with team numbers, including 'change the teams to " +
    "match this list'. Copy names and emails exactly as the list has them; do not match them to " +
    "the roster yourself — the importer does that.",
  schema: {
    type: "object",
    properties: {
      summary: SUMMARY,
      rows: {
        type: "array",
        description: "One row per student in the list, in the list's order.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "First and last name, as the list writes them." },
            email: { type: "string", description: "Their email, when the list has one." },
            team: { type: "integer", description: "Their team number, when the list gives one." },
          },
          required: ["name"],
        },
      },
    },
    required: ["summary", "rows"],
  },
};

export const TOOLS: ToolSpec[] = [SEAT_STUDENTS, PREPARE_IMPORT];

export type ParsedCall = { ok: true; proposal: Proposal } | { ok: false; error: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A trimmed string, or null when it is absent, blank or not a string. */
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

class Refusal extends Error {}

function refuse(why: string): never {
  throw new Refusal(why);
}

function list(v: unknown, what: string, optional = false): unknown[] {
  if ((v === undefined || v === null) && optional) return [];
  if (!Array.isArray(v)) refuse(`${what} is not a list`);
  if (v.length > MAX_ENTRIES) refuse(`${what} has more than ${MAX_ENTRIES} entries`);
  return v;
}

function summaryOf(input: Obj): string {
  const s = text(input.summary);
  if (!s) refuse("the draft has no summary");
  return s.slice(0, MAX_SUMMARY);
}

function teamName(v: unknown, what: string): string {
  const name = text(v);
  if (!name) refuse(`${what} has no name`);
  if (name.length > MAX_TEAM_NAME) refuse(`${what} is longer than ${MAX_TEAM_NAME} characters`);
  return name;
}

function seatMove(v: unknown, i: number): SeatMove {
  if (!isObj(v)) refuse(`move ${i + 1} is not an object`);
  const student = text(v.student);
  if (!student) refuse(`move ${i + 1} names no student`);
  const toTeam = text(v.to_team);
  // Blank or null is "no new team" — models fill unused optional fields that way.
  const toNewTeam = text(v.to_new_team) === null ? null : teamName(v.to_new_team, `move ${i + 1}'s new team`);
  if (!toTeam && !toNewTeam) refuse(`move ${i + 1} names no team`);
  if (toTeam && toNewTeam) refuse(`move ${i + 1} names both an existing team and a new one`);
  return { student, toTeam, toNewTeam };
}

function parseSeat(input: Obj): Proposal {
  const summary = summaryOf(input);
  const moves = list(input.moves, "moves").map(seatMove);
  const renames = list(input.renames, "renames", true).map((r, i) => {
    if (!isObj(r)) refuse(`rename ${i + 1} is not an object`);
    const team = text(r.team);
    if (!team) refuse(`rename ${i + 1} names no team`);
    return { team, name: teamName(r.name, `rename ${i + 1}`) };
  });
  const unresolved = list(input.unresolved, "unresolved", true).flatMap((u) => {
    if (!isObj(u)) return [];
    const entry = text(u.entry);
    return entry ? [{ entry, reason: text(u.reason) ?? "Not matched to a student." }] : [];
  });
  return { kind: "seat", summary, moves, renames, unresolved };
}

function importRow(v: unknown, i: number): ImportRow {
  if (!isObj(v)) refuse(`row ${i + 1} is not an object`);
  const name = text(v.name);
  if (!name) refuse(`row ${i + 1} has no name`);
  let team: number | null = null;
  if (v.team !== undefined && v.team !== null) {
    if (typeof v.team !== "number" || !Number.isInteger(v.team) || v.team < 0 || v.team > MAX_TEAM_NUMBER) {
      refuse(`row ${i + 1}'s team is not a whole number`);
    }
    team = v.team;
  }
  return { name, email: text(v.email), team };
}

function parseImport(input: Obj): Proposal {
  const summary = summaryOf(input);
  const rows = list(input.rows, "rows").map(importRow);
  if (!rows.length) refuse("the list has no rows");
  return { kind: "import", summary, rows };
}

/**
 * The model's tool call as a proposal the browser can draw — or why not.
 *
 * Strict about shape, because a half-read draft is worse than none: a move that
 * lost its team would preview as a student going nowhere. The refusal is worded
 * for the instructor, since it ends up on her screen.
 */
export function parseToolCall(name: string, input: unknown): ParsedCall {
  try {
    if (!isObj(input)) refuse("the draft came back empty");
    if (name === SEAT_STUDENTS.name) return { ok: true, proposal: parseSeat(input) };
    if (name === PREPARE_IMPORT.name) return { ok: true, proposal: parseImport(input) };
    return refuse(`it asked for "${name}", which the assistant cannot do`);
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
}
