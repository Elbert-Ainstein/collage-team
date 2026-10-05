// The class as the assistant is shown it, and the key back from its refs.
//
// Refs are handed out in the order the Teams screen lists things, so "s1" is
// the first name the instructor sees and "t1" the first team. The map back to
// row ids never leaves the browser: the server and the model only ever see
// refs, and a ref is only turned into a row here, against the class as it is
// when Apply is pressed.

import type { Snapshot } from "@/assistant/types";
import type { Course, Student, TeamWithMembers } from "@/checkins/types";

export interface Refs {
  /** ref → student id */
  students: Map<string, string>;
  /** ref → team id */
  teams: Map<string, string>;
}

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/**
 * A student's name is whatever they signed up with, uncapped. Shortened here
 * rather than refused on the server, so one very long name cannot get every
 * request for the course turned away — and cannot fill the prompt either.
 */
const MAX_NAME = 120;
const MAX_EMAIL = 254;
const clamp = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function buildSnapshot(input: {
  course: Pick<Course, "name" | "code" | "term">;
  roster: Student[];
  teams: TeamWithMembers[];
}): { snapshot: Snapshot; refs: Refs } {
  const students = [...input.roster].sort(byPosition);
  const teams = [...input.teams].sort(byPosition);

  const refOf = new Map<string, string>();
  const refs: Refs = { students: new Map(), teams: new Map() };
  students.forEach((s, i) => {
    const ref = `s${i + 1}`;
    refOf.set(s.id, ref);
    refs.students.set(ref, s.id);
  });
  teams.forEach((t, i) => refs.teams.set(`t${i + 1}`, t.id));

  return {
    snapshot: {
      course: { name: input.course.name, code: input.course.code ?? null, term: input.course.term ?? null },
      students: students.map((s) => ({
        ref: refOf.get(s.id) as string,
        name: clamp(s.name, MAX_NAME),
        email: s.email ? clamp(s.email, MAX_EMAIL) : null,
      })),
      teams: teams.map((t, i) => ({
        ref: `t${i + 1}`,
        name: clamp(t.name, MAX_NAME),
        // A member missing from the roster has no ref to give the model, and
        // the model has no use for a name it cannot move.
        members: [...t.members]
          .sort(byPosition)
          .flatMap((m) => (refOf.has(m.id) ? [refOf.get(m.id) as string] : [])),
      })),
    },
    refs,
  };
}
