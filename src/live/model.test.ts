import { describe, expect, it } from "vitest";
import { buildLiveModel, outcomeOf } from "./model";
import type { LiveSnapshot } from "./types";
import type { Student, TeamWithMembers } from "@/checkins/types";

const T0 = Date.parse("2026-10-27T10:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

const student = (id: string): Student =>
  ({ id, name: id.toUpperCase(), course_id: "c", email: null, avatar_tint: null, position: 0 }) as unknown as Student;
const team = (id: string, members: string[]): TeamWithMembers =>
  ({ id, name: `Team ${id}`, team_set_id: "s", position: 0, members: members.map(student) }) as unknown as TeamWithMembers;

function snapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    state: {
      activity_id: "a",
      phase: "team",
      lock_rule: "any",
      show_answers: "close",
      grading: "both",
      team_started_at: iso(0),
      closed_at: null,
      scored_at: null,
      updated_at: iso(0),
    },
    questions: [
      { id: "q1", activity_id: "a", position: 0, kind: "mc", stem: "", options: ["x", "y", "z"], unit: null, figure_path: null, created_at: "" },
      { id: "q2", activity_id: "a", position: 1, kind: "number", stem: "", options: [], unit: "m/s", figure_path: null, created_at: "" },
      { id: "q3", activity_id: "a", position: 2, kind: "expression", stem: "", options: [], unit: null, figure_path: null, created_at: "" },
    ],
    keys: [
      { question_id: "q1", activity_id: "a", correct_option: 1, answer: null, tolerance: null, accept: [] },
      { question_id: "q2", activity_id: "a", correct_option: null, answer: 19.6, tolerance: 0.5, accept: [] },
      { question_id: "q3", activity_id: "a", correct_option: null, answer: null, tolerance: null, accept: ["F/2"] },
    ],
    responses: [
      { question_id: "q1", activity_id: "a", student_id: "s1", answer: "B", correct: null, updated_at: "" },
      { question_id: "q2", activity_id: "a", student_id: "s1", answer: "20", correct: null, updated_at: "" },
      { question_id: "q3", activity_id: "a", student_id: "s1", answer: "0.5F", correct: null, updated_at: "" },
      { question_id: "q1", activity_id: "a", student_id: "s2", answer: "C", correct: null, updated_at: "" },
    ],
    votes: [
      { question_id: "q2", activity_id: "a", team_id: "t1", student_id: "s1", answer: "19.6", updated_at: "" },
      { question_id: "q2", activity_id: "a", team_id: "t1", student_id: "s2", answer: "20", updated_at: "" },
    ],
    locks: [{ question_id: "q1", activity_id: "a", team_id: "t1", answer: "B", correct: null, locked_by: "s1", locked_at: iso(70) }],
    ...over,
  };
}

const model = (over: Partial<LiveSnapshot> = {}, verdicts: Record<string, Record<string, boolean>> = { q3: { "0.5F": true } }) =>
  buildLiveModel({
    snapshot: snapshot(over),
    students: [student("s1"), student("s2"), student("s3")],
    teams: [team("t1", ["s1", "s2"]), team("t2", ["s3"])],
    verdicts,
    now: T0 + 100_000,
  });

describe("own answers", () => {
  it("reads each student's answer per question and counts them", () => {
    const m = model();
    expect(m.own("s1", 0)).toBe("B");
    expect(m.own("s3", 0)).toBeNull();
    expect(m.answered("s1")).toBe(3);
    expect(m.answered("s2")).toBe(1);
  });

  it("scores with the key, expressions by the verdicts", () => {
    const m = model();
    expect(m.ownScore("s1")).toBe(3);
    expect(m.ownScore("s2")).toBe(0);
    expect(m.right(2, "2F")).toBe(false);
  });

  it("uses the database's verdict once the session is scored", () => {
    const m = model(
      {
        responses: [{ question_id: "q3", activity_id: "a", student_id: "s1", answer: "weird", correct: true, updated_at: "" }],
      },
      {},
    );
    expect(m.ownScore("s1")).toBe(1);
  });

  it("knows nothing is right or wrong without the key", () => {
    const m = model({ keys: [] });
    expect(m.right(0, "B")).toBeNull();
    expect(m.ownScore("s1")).toBeNull();
  });
});

describe("teams", () => {
  it("puts each lock under its question", () => {
    const m = model();
    expect(m.locks("t1").map((l) => l?.answer ?? null)).toEqual(["B", null, null]);
    expect(m.done("t1")).toBe(1);
    expect(m.score("t1")).toBe(1);
  });

  it("is on the first question it hasn't locked, with everyone's vote", () => {
    const m = model();
    const cur = m.current("t1")!;
    expect(cur.q).toBe(1);
    expect(cur.votes).toEqual(["19.6", "20"]);
    // 100 s now − 70 s, when it locked question 1
    expect(cur.since).toBe(30);
  });

  it("has no current question once every one is locked, and knows when it finished", () => {
    const m = model({
      locks: [
        { question_id: "q1", activity_id: "a", team_id: "t1", answer: "B", correct: null, locked_by: "s1", locked_at: iso(70) },
        { question_id: "q2", activity_id: "a", team_id: "t1", answer: "20", correct: null, locked_by: "s2", locked_at: iso(150) },
        { question_id: "q3", activity_id: "a", team_id: "t1", answer: "F/2", correct: null, locked_by: "s2", locked_at: iso(200) },
      ],
    });
    expect(m.current("t1")).toBeNull();
    expect(m.finishedAt("t1")).toBe(200);
    expect(m.durations("t1")).toEqual([70, 80, 50]);
  });

  it("finds a student's team", () => {
    expect(model().teamOf("s2")?.id).toBe("t1");
    expect(model().teamOf("nobody")).toBeNull();
  });

  it("has no current question outside team mode", () => {
    const m = model({ state: { ...snapshot().state, phase: "individual", team_started_at: null } });
    expect(m.current("t1")).toBeNull();
  });
});

describe("outcomeOf", () => {
  it("says what happened between the student and the team", () => {
    expect(outcomeOf(true, true).label).toBe("Right both times");
    expect(outcomeOf(false, true).label).toBe("Team brought them round");
    expect(outcomeOf(true, false).label).toBe("Was right — team went another way");
    expect(outcomeOf(false, false).label).toBe("Missed both times");
    expect(outcomeOf(null, null).tone).toBe("muted");
  });
});
