import { describe, expect, it } from "vitest";
import { buildLiveModel, fmtPoints, outcomeOf } from "./model";
import type { LiveAttempt, LiveSnapshot } from "./types";
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
    attempts: [],
    teamSetup: false,
    leaderVotes: [],
    setups: [],
    absences: [],
    roster: [],
    explanations: [],
    ...over,
  };
}

const attempt = (question_id: string, n: number, answer: string, correct: boolean | null, at = 0, team_id = "t1"): LiveAttempt => ({
  question_id,
  activity_id: "a",
  team_id,
  attempt: n,
  answer,
  correct,
  locked_by: "s1",
  locked_at: iso(at),
});
const lock = (question_id: string, answer: string, correct: boolean | null, at = 0, team_id = "t1") => ({
  question_id,
  activity_id: "a",
  team_id,
  answer,
  correct,
  locked_by: "s1",
  locked_at: iso(at),
});

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

describe("team tries", () => {
  // q1 (3 options, key B): C wrong, then B right. q2 (number): 3 wrong tries, out.
  const tried = () =>
    model({
      locks: [lock("q1", "B", true, 70), lock("q2", "1", false, 150)],
      attempts: [
        attempt("q1", 1, "C", false, 40),
        attempt("q1", 2, "B", true, 70),
        attempt("q2", 1, "3", false, 100),
        attempt("q2", 2, "2", false, 120),
        attempt("q2", 3, "1", false, 150),
      ],
    });

  it("lists every try in order and knows which one was right", () => {
    const m = tried();
    expect(m.tries("t1", 0).map((t) => t.answer)).toEqual(["C", "B"]);
    expect(m.rightOn("t1", 0)).toBe(2);
    expect(m.rightOn("t1", 1)).toBe(0);
    expect(m.rightOn("t1", 2)).toBe(0);
  });

  it("is worth less the more tries it took: 1, 0.5, 0.25, then nothing", () => {
    const m = model({
      locks: [lock("q1", "B", true), lock("q2", "19.6", true), lock("q3", "F/2", true)],
      attempts: [
        attempt("q1", 1, "B", true),
        attempt("q2", 1, "1", false),
        attempt("q2", 2, "19.6", true),
        attempt("q3", 1, "F", false),
        attempt("q3", 2, "2F", false),
        attempt("q3", 3, "F/2", true),
      ],
    });
    expect([0, 1, 2].map((q) => m.credit("t1", q))).toEqual([1, 0.5, 0.25]);
    expect(m.score("t1")).toBe(1.75);
    expect(tried().score("t1")).toBe(0.5);
  });

  it("trusts the verdict the team was given over its own reading of the key", () => {
    // The key says B; the database, judging when the team submitted, said C was right.
    const m = model({ locks: [lock("q1", "C", true)], attempts: [attempt("q1", 1, "C", true)] });
    expect(m.rightOn("t1", 0)).toBe(1);
  });

  it("counts a lock from before tries existed as one try, judged by the key", () => {
    const m = model();
    expect(m.tries("t1", 0)).toHaveLength(1);
    expect(m.credit("t1", 0)).toBe(1);
    expect(model({ keys: [] }).score("t1")).toBeNull();
  });

  it("doesn't count a vote still sitting on an answer the team has tried", () => {
    const m = model({
      locks: [lock("q1", "B", true, 70)],
      attempts: [attempt("q1", 1, "B", true, 70), attempt("q2", 1, "19.6", false, 90)],
    });
    // s1's vote is on 19.6, which the team just tried and was told is wrong.
    expect(m.current("t1")?.votes).toEqual([null, "20"]);
  });

  it("is on the question it's still trying, however many wrong tries in", () => {
    const m = tried();
    const cur = m.current("t1")!;
    expect(cur.q).toBe(2);
    expect(m.done("t1")).toBe(2);
  });

  it("applies to both ways of grading: the team's score doesn't depend on it", () => {
    const both = tried();
    const teamOnly = model({
      state: { ...snapshot().state, grading: "team" },
      locks: [lock("q1", "B", true, 70), lock("q2", "1", false, 150)],
      attempts: tried().tries("t1", 0).concat(tried().tries("t1", 1)),
    });
    expect(teamOnly.score("t1")).toBe(both.score("t1"));
  });
});

describe("fmtPoints", () => {
  it("shows points as decimals, two places at most", () => {
    expect(fmtPoints(3)).toBe("3");
    expect(fmtPoints(2.5)).toBe("2.5");
    expect(fmtPoints(1.75)).toBe("1.75");
    expect(fmtPoints(0.25)).toBe("0.25");
    expect(fmtPoints(0)).toBe("0");
    expect(fmtPoints(1 / 3)).toBe("0.33");
  });
});

describe("outcomeOf", () => {
  it("says what happened between the student and the team", () => {
    expect(outcomeOf(true, 1).label).toBe("Right both times");
    expect(outcomeOf(false, 1).label).toBe("Team brought them round");
    expect(outcomeOf(true, 0).label).toBe("Was right — team went another way");
    expect(outcomeOf(true, 2).label).toBe("Was right — team went another way");
    expect(outcomeOf(false, 3).label).toBe("Team got there on try 3");
    expect(outcomeOf(false, 0).label).toBe("Missed both times");
    expect(outcomeOf(null, null).tone).toBe("muted");
  });
});

describe("the team's leader, roll and explanations (0051)", () => {
  const led = (over: Partial<LiveSnapshot> = {}) =>
    model({
      teamSetup: true,
      setups: [{ activity_id: "a", team_id: "t1", leader_id: "s1", leader_at: iso(5), roll_at: null }],
      leaderVotes: [
        { activity_id: "a", team_id: "t1", student_id: "s1", candidate_id: "s1", updated_at: "" },
        { activity_id: "a", team_id: "t1", student_id: "s2", candidate_id: "s1", updated_at: "" },
      ],
      explanations: [{ question_id: "q2", activity_id: "a", body: "Because g." }],
      ...over,
    });

  it("tallies the team's own members", () => {
    expect(led().leaderTally("t1")).toMatchObject({ agreed: "s1", voted: 2, present: 2, everyoneVoted: true });
    expect(led().leaderTally("t2")).toMatchObject({ voted: 0, present: 1 });
  });

  it("says who leads and who may submit, and where the team is", () => {
    const m = led();
    expect(m.leaderOf("t1")).toBe("s1");
    expect(m.mayLead("t1", "s1")).toBe(true);
    expect(m.mayLead("t1", "s2")).toBe(false);
    expect(m.stage("t1")).toBe("roll");
    expect(m.stage("t2")).toBe("leader");
  });

  it("knows who is out", () => {
    const m = led({ absences: [{ activity_id: "a", team_id: "t1", student_id: "s2", source: "roll" }] });
    expect(m.absentIds("t1")).toEqual(["s2"]);
    expect(m.isAbsent("s2")).toBe(true);
  });

  it("gives someone marked absent nothing for team time, and their teammates the team's score", () => {
    const m = led({
      locks: [lock("q1", "B", true)],
      absences: [{ activity_id: "a", team_id: "t1", student_id: "s2", source: "roll" }],
    });
    expect(m.score("t1")).toBe(1);
    expect(m.memberScore("s1")).toBe(1);
    expect(m.memberScore("s2")).toBe(0);
    expect(m.memberScore("nobody")).toBeNull();
  });

  it("reads an explanation by question index", () => {
    expect(led().explanation(1)).toBe("Because g.");
    expect(led().explanation(0)).toBeNull();
    expect(led().explanation(9)).toBeNull();
  });

  it("is plain team play without 0051", () => {
    expect(model().stage("t1")).toBe("play");
    expect(model().mayLead("t1", "s2")).toBe(true);
  });
});
