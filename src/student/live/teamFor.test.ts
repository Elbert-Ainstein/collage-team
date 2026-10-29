// Who a student's screen counts as their team: the frozen roster once team
// mode has started (0051), so it offers only what the leader RPCs will take.

import { describe, expect, it } from "vitest";
import type { Enrolment } from "@/checkins/studentData";
import type { Student } from "@/checkins/types";
import type { LiveRosterMember, LiveSnapshot } from "@/live/types";
import { teamFor } from "./teamFor";

const student = (id: string, name: string): Student =>
  ({ id, name, course_id: "c", email: null, avatar_tint: null, position: 0, created_at: "" }) as Student;

// A is now on T with C; B was moved off after team mode froze T as {A, B}.
const enrolment = {
  student: student("A", "Ana"),
  course: { id: "c" },
  team: { id: "T", name: "Team T" },
  teammates: [student("C", "Cy")],
} as unknown as Enrolment;

const member = (student_id: string, name: string | null = null): LiveRosterMember => ({
  team_id: "T",
  student_id,
  name,
  avatar_tint: null,
});

function snap(phase: "individual" | "team", roster: LiveRosterMember[]): LiveSnapshot {
  return {
    state: { activity_id: "x", phase } as LiveSnapshot["state"],
    questions: [],
    keys: [],
    responses: [],
    votes: [],
    locks: [],
    attempts: [],
    teamSetup: roster.length > 0,
    leaderVotes: [],
    setups: [],
    absences: [],
    roster,
    explanations: [],
  };
}

const ids = (s: LiveSnapshot | null) => teamFor(enrolment, "T", s)?.members.map((m) => [m.id, m.name]);

describe("teamFor", () => {
  it("counts the frozen roster once team mode has started, named from it", () => {
    expect(ids(snap("team", [member("A", "Ana"), member("B", "Bo")]))).toEqual([
      ["A", "Ana"],
      ["B", "Bo"],
    ]);
  });

  it("calls someone it can't name a teammate", () => {
    expect(ids(snap("team", [member("A"), member("B")]))).toEqual([
      ["A", "Ana"],
      ["B", "Teammate"],
    ]);
  });

  it("goes by today's team before team mode, or with no roster to read", () => {
    expect(ids(snap("individual", [member("A"), member("B")]))).toEqual([
      ["A", "Ana"],
      ["C", "Cy"],
    ]);
    expect(ids(snap("team", []))).toEqual([
      ["A", "Ana"],
      ["C", "Cy"],
    ]);
    expect(ids(null)).toEqual([
      ["A", "Ana"],
      ["C", "Cy"],
    ]);
  });

  it("is no team at all without one", () => {
    expect(teamFor({ ...enrolment, team: null }, null, null)).toBeNull();
  });
});
