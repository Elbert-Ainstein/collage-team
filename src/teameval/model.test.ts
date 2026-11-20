import { describe, expect, it } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import {
  buildResults,
  draftFrom,
  draftPayload,
  fmtAvg,
  gradeFor,
  isLate,
  leftFor,
  outOf,
  pagesFor,
  peerAverage,
} from "./model";
import type {
  TeamEvalCategory,
  TeamEvalMember,
  TeamEvalQuestion,
  TeamEvalRating,
  TeamEvalSnapshot,
  TeamEvalSubmission,
} from "./types";

const DUE = "2026-11-10T17:00:00.000Z";
const student = (id: string, name: string) => ({ id, name, avatar_tint: null }) as unknown as Student;
const [ana, bo, cy, di] = [student("a", "Ana"), student("b", "Bo"), student("c", "Cy"), student("d", "Di")];
const TEAM = { id: "t1", name: "Team 1", members: [ana, bo, cy] } as unknown as TeamWithMembers;

const cat = (id: string, position: number): TeamEvalCategory => ({
  id,
  activity_id: "e",
  position,
  name: id,
  levels: ["1", "2", "3", "4", "5"],
  created_at: "",
});
const q = (id: string, audience: "peer" | "self"): TeamEvalQuestion => ({ id, activity_id: "e", position: 0, audience, prompt: id, created_at: "" });
const rate = (rater: string, ratee: string, category: string, score: number): TeamEvalRating => ({
  activity_id: "e",
  category_id: category,
  rater_id: rater,
  ratee_id: ratee,
  score,
  updated_at: "",
});
const sub = (id: string, at: string, late_override: boolean | null = null): TeamEvalSubmission => ({
  activity_id: "e",
  student_id: id,
  submitted_at: at,
  late_override,
});

describe("peerAverage", () => {
  const ratings = [
    rate("a", "a", "c1", 5), // Ana on herself
    rate("b", "a", "c1", 3),
    rate("c", "a", "c1", 1), // Cy never submitted
  ];

  it("leaves out the student's own rating and anyone who didn't submit", () => {
    expect(peerAverage(ratings, new Set(["a", "b"]), "a", "c1")).toEqual({ avg: 3, n: 1 });
  });

  it("takes a late submission in once it's there", () => {
    expect(peerAverage(ratings, new Set(["a", "b", "c"]), "a", "c1")).toEqual({ avg: 2, n: 2 });
  });

  it("is nothing, not zero, when no teammate submitted", () => {
    expect(peerAverage(ratings, new Set(["a"]), "a", "c1")).toEqual({ avg: null, n: 0 });
    expect(fmtAvg(null)).toBe("—");
  });
});

describe("lateness and the grade", () => {
  it("is late after the due date, unless staff say otherwise", () => {
    expect(isLate(sub("a", "2026-11-10T16:00:00.000Z"), DUE)).toBe(false);
    expect(isLate(sub("a", "2026-11-10T18:00:00.000Z"), DUE)).toBe(true);
    expect(isLate(sub("a", "2026-11-10T18:00:00.000Z", false), DUE)).toBe(false);
    expect(isLate(sub("a", "2026-11-10T16:00:00.000Z", true), DUE)).toBe(true);
    expect(isLate(sub("a", "2026-11-10T18:00:00.000Z"), null)).toBe(false);
  });

  it("is their points on time, less the penalty late, and 0 if they never submitted", () => {
    expect(gradeFor(sub("a", "2026-11-10T16:00:00.000Z"), DUE, 12.5, 15)).toBe(12.5);
    expect(gradeFor(sub("a", "2026-11-11T16:00:00.000Z"), DUE, 10, 15)).toBe(8.5);
    expect(gradeFor(null, DUE, 20, 15)).toBe(0);
  });

  it("waits when nobody has rated them yet", () => {
    expect(gradeFor(sub("a", "2026-11-10T16:00:00.000Z"), DUE, null, 15)).toBeNull();
  });

  it("is out of 5 per category", () => {
    expect(outOf([1, 2, 3, 4, 5])).toBe(25);
  });
});

describe("buildResults", () => {
  const snapshot: TeamEvalSnapshot = {
    settings: {
      activity_id: "e",
      peer_comments: true,
      release_comments: true,
      anonymize: true,
      late_penalty: 20,
      released_at: null,
      scored_at: null,
      updated_at: "",
    },
    categories: [cat("c1", 0), cat("c2", 1)],
    questions: [],
    ratings: [
      rate("a", "b", "c1", 4),
      rate("a", "b", "c2", 2),
      rate("c", "b", "c1", 2),
      rate("c", "b", "c2", 4),
      rate("b", "b", "c1", 5),
      rate("a", "c", "c1", 5),
      rate("a", "c", "c2", 4),
      rate("b", "a", "c1", 3),
      rate("b", "a", "c2", 3),
    ],
    comments: [],
    submissions: [sub("a", "2026-11-10T10:00:00.000Z"), sub("b", "2026-11-10T10:00:00.000Z"), sub("c", "2026-11-12T10:00:00.000Z")],
  };
  const groups = buildResults({ snapshot, teams: [TEAM], roster: [ana, bo, cy, di], dueAt: DUE });
  const rowOf = (id: string) => groups.flatMap((g) => g.rows).find((r) => r.student.id === id)!;

  it("averages each category over submitted teammates", () => {
    const b = rowOf("b");
    expect(b.categories.map((c) => c.avg)).toEqual([3, 3]);
    expect(b.categories[0].n).toBe(2);
    expect(b.categories[0].self).toBe(5);
  });

  it("grades each student on the sum of their category averages", () => {
    expect(rowOf("b").points).toBe(6); // 3 + 3, their own 5 left out
    expect(rowOf("b").grade).toBe(6);
    expect(rowOf("a").grade).toBe(6); // 3 + 3 from Bo
  });

  it("flags the late submitter and takes the penalty off their own grade", () => {
    expect(rowOf("c").late).toBe(true);
    expect(rowOf("c").points).toBe(9); // 5 + 4 from Ana
    expect(rowOf("c").grade).toBe(7.2); // 20% off
  });

  it("puts someone on no team in a group of their own, with 0 for not submitting", () => {
    expect(groups.map((g) => g.team?.id ?? null)).toEqual(["t1", null]);
    expect(rowOf("d").grade).toBe(0);
    expect(rowOf("d").points).toBeNull();
  });
});

describe("the student form", () => {
  it("sends what's been filled in, without blank answers", () => {
    const draft = draftFrom([rate("a", "b", "c1", 4)], []);
    draft.comments.b = { qp: "  ", qs: " x " };
    expect(draftPayload(draft)).toEqual({
      ratings: [{ category_id: "c1", ratee_id: "b", score: 4 }],
      comments: [{ question_id: "qs", subject_id: "b", body: "x" }],
    });
  });
});

describe("the form, one page per person", () => {
  const categories = [cat("c1", 0), cat("c2", 1)];
  const questions = [q("qp", "peer"), q("qs", "self")];
  const member = (id: string, is_me = false): TeamEvalMember => ({ student_id: id, name: id, avatar_tint: null, is_me });
  const team = [member("a", true), member("b"), member("c")];

  it("goes teammate by teammate, then the student last", () => {
    expect(pagesFor(team).map((m) => m.student_id)).toEqual(["b", "c", "a"]);
  });

  it("counts what's left on a page: categories to rate and questions to answer", () => {
    const ev = { categories, questions, settings: { peer_comments: true } };
    const draft = draftFrom([rate("a", "b", "c1", 2), rate("a", "a", "c1", 4), rate("a", "a", "c2", 4)], []);
    expect(leftFor(team[1], ev, draft)).toBe(2); // c2 and the peer question
    expect(leftFor(team[2], ev, draft)).toBe(3); // everything
    expect(leftFor(team[0], ev, draft)).toBe(1); // the reflection
    draft.comments.a = { qs: "done" };
    expect(leftFor(team[0], ev, draft)).toBe(0);
    // No questions about teammates: rating them is all there is.
    expect(leftFor(team[1], { ...ev, settings: { peer_comments: false } }, draft)).toBe(1);
  });
});
