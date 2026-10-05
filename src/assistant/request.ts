// Checking a request body before any of it reaches the model.
//
// The body is whatever a browser sent, so nothing in it is trusted: not its
// shape, not its size, and not its snapshot. The snapshot only has to be
// well-formed here — the server never acts on it, it only describes the class
// to the model — but a malformed one would make a prompt the model misreads.

import type {
  AssistantRequest,
  AttachmentColumn,
  AttachmentSummary,
  Snapshot,
  SnapshotStudent,
  SnapshotTeam,
  Turn,
} from "./types";

/** Room for a 500-student class list pasted whole, with a header and notes. */
export const MAX_MESSAGE = 60_000;
const MAX_TURNS = 24;
const MAX_HISTORY_CHARS = 80_000;
const MAX_STUDENTS = 2_000;
const MAX_TEAMS = 500;
const MAX_NAME = 200;
const MAX_EMAIL = 320;

/** Course ids are uuids; anything else would only make Postgres throw. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STUDENT_REF = /^s\d{1,5}$/;
const TEAM_REF = /^t\d{1,5}$/;

export type ParsedRequest = { ok: true; request: AssistantRequest } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Bad extends Error {}
function bad(why: string): never {
  throw new Bad(why);
}

function str(v: unknown, what: string, max: number): string {
  if (typeof v !== "string") bad(`${what} is missing`);
  if (v.length > max) bad(`${what} is too long`);
  return v;
}

function optStr(v: unknown, what: string, max: number): string | null {
  if (v === null || v === undefined || v === "") return null;
  return str(v, what, max);
}

function arr(v: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(v)) bad(`${what} is not a list`);
  if (v.length > max) bad(`${what} has too many entries`);
  return v;
}

function turn(v: unknown): Turn {
  if (!isObj(v)) bad("a history turn is not an object");
  if (v.role !== "user" && v.role !== "assistant") bad("a history turn has an unknown role");
  return { role: v.role, text: str(v.text, "a history turn", MAX_MESSAGE) };
}

function student(v: unknown): SnapshotStudent {
  if (!isObj(v)) bad("a student is not an object");
  const ref = str(v.ref, "a student's ref", 8);
  if (!STUDENT_REF.test(ref)) bad(`"${ref}" is not a student ref`);
  return {
    ref,
    name: str(v.name, "a student's name", MAX_NAME),
    email: optStr(v.email, "a student's email", MAX_EMAIL),
  };
}

function team(v: unknown, known: Set<string>): SnapshotTeam {
  if (!isObj(v)) bad("a team is not an object");
  const ref = str(v.ref, "a team's ref", 8);
  if (!TEAM_REF.test(ref)) bad(`"${ref}" is not a team ref`);
  const members = arr(v.members, "a team's members", MAX_STUDENTS).map((m) => {
    const r = str(m, "a team member", 8);
    if (!known.has(r)) bad(`team ${ref} lists ${r}, who is not in the snapshot`);
    return r;
  });
  return { ref, name: str(v.name, "a team's name", MAX_NAME), members };
}

function snapshot(v: unknown): Snapshot {
  if (!isObj(v)) bad("the snapshot is missing");
  if (!isObj(v.course)) bad("the snapshot has no course");
  const students = arr(v.students, "the snapshot's students", MAX_STUDENTS).map(student);
  const known = new Set(students.map((s) => s.ref));
  if (known.size !== students.length) bad("the snapshot repeats a student ref");
  const teams = arr(v.teams, "the snapshot's teams", MAX_TEAMS).map((t) => team(t, known));
  if (new Set(teams.map((t) => t.ref)).size !== teams.length) bad("the snapshot repeats a team ref");
  return {
    course: {
      name: str(v.course.name, "the course name", MAX_NAME),
      code: optStr(v.course.code, "the course code", MAX_NAME),
      term: optStr(v.course.term, "the course term", MAX_NAME),
    },
    students,
    teams,
  };
}

/** A registrar export can be wide. Matches MAX_SUMMARY_COLUMNS in the browser. */
const MAX_COLUMNS = 200;
const MAX_VALUES = 15;
const KINDS = new Set(["number", "category", "text"]);

const count = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100_000) bad(`${what} is not a count`);
  return v;
};
const optNumber = (v: unknown, what: string): number | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) bad(`${what} is not a number`);
  return v;
};

function column(v: unknown): AttachmentColumn {
  if (!isObj(v)) bad("a file column is not an object");
  if (typeof v.kind !== "string" || !KINDS.has(v.kind)) bad("a file column has an unknown kind");
  const values =
    v.values === undefined
      ? undefined
      : arr(v.values, "a column's values", MAX_VALUES).map((x) => {
          if (!isObj(x)) bad("a column value is not an object");
          return { value: str(x.value, "a column value", 80), count: count(x.count, "a value count") };
        });
  if (v.looksLike !== undefined && v.looksLike !== "email" && v.looksLike !== "name") bad("a column has an unknown look");
  return {
    name: str(v.name, "a column name", 100),
    kind: v.kind as AttachmentColumn["kind"],
    filled: count(v.filled, "a column's filled count"),
    distinct: count(v.distinct, "a column's distinct count"),
    ...(values ? { values } : {}),
    ...(v.min !== undefined ? { min: optNumber(v.min, "a column's minimum") } : {}),
    ...(v.max !== undefined ? { max: optNumber(v.max, "a column's maximum") } : {}),
    ...(v.mean !== undefined ? { mean: optNumber(v.mean, "a column's average") } : {}),
    ...(v.looksLike ? { looksLike: v.looksLike as "email" | "name" } : {}),
  };
}

/** A SUMMARY of an attached file — never its rows; see AttachmentColumn. */
function attachment(v: unknown): AttachmentSummary | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) bad("the attachment is not an object");
  return {
    name: str(v.name, "the attachment's name", 200),
    rows: count(v.rows, "the attachment's row count"),
    columns: arr(v.columns, "the attachment's columns", MAX_COLUMNS).map(column),
  };
}

export function parseRequest(body: unknown): ParsedRequest {
  try {
    if (!isObj(body)) bad("the request is not an object");
    const courseId = str(body.courseId, "the course id", 64);
    if (!ID_RE.test(courseId)) bad("the course id is not an id");
    const message = str(body.message, "the message", MAX_MESSAGE).trim();
    if (!message) bad("the message is empty");
    const history = body.history === undefined ? [] : arr(body.history, "the history", MAX_TURNS).map(turn);
    if (history.reduce((n, t) => n + t.text.length, 0) > MAX_HISTORY_CHARS) {
      bad("the conversation is too long — start a new one");
    }
    const file = attachment(body.attachment);
    return {
      ok: true,
      request: { courseId, message, history, snapshot: snapshot(body.snapshot), ...(file ? { attachment: file } : {}) },
    };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}
