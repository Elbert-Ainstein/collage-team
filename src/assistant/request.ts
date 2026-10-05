// Checking a request body before any of it reaches the model.
//
// The body is whatever a browser sent, so nothing in it is trusted: not its
// shape, not its size, and not its snapshot. The snapshot only has to be
// well-formed here — the server never acts on it, it only describes the class
// to the model — but a malformed one would make a prompt the model misreads.

import type { AssistantRequest, Snapshot, SnapshotStudent, SnapshotTeam, Turn } from "./types";

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
    return { ok: true, request: { courseId, message, history, snapshot: snapshot(body.snapshot) } };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}
