import { describe, expect, it } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import {
  buildResults,
  leftInStep,
  reasonNeeded,
  stepsFor,
  draftFrom,
  draftPayload,
  fmtAvg,
  gradeFor,
  isLate,
  peerAverage,
} from "./model";
import type { TeamEvalCategory, TeamEvalQuestion, TeamEvalRating, TeamEvalSnapshot, TeamEvalSubmission } from "./types";

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
const rate = (rater: string, ratee: string, category: string, score: number, reason: string | null = null): TeamEvalRating => ({
  activity_id: "e",
  category_id: category,
  rater_id: rater,
  ratee_id: ratee,
  score,
  reason,
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

  it("gives the points on time, less the penalty late, and nothing for none", () => {
    expect(gradeFor(sub("a", "2026-11-10T16:00:00.000Z"), DUE, 10, 15)).toBe(10);
    expect(gradeFor(sub("a", "2026-11-11T16:00:00.000Z"), DUE, 10, 15)).toBe(8.5);
    expect(gradeFor(null, DUE, 10, 15)).toBe(0);
  });
});

describe("buildResults", () => {
  const snapshot: TeamEvalSnapshot = {
    settings: {
      activity_id: "e",
      peer_comments: true,
      release_comments: true,
      anonymize: true,
      reasons: "none",
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
    ],
    comments: [],
    submissions: [sub("a", "2026-11-10T10:00:00.000Z"), sub("b", "2026-11-10T10:00:00.000Z"), sub("c", "2026-11-12T10:00:00.000Z")],
  };
  const groups = buildResults({ snapshot, teams: [TEAM], roster: [ana, bo, cy, di], dueAt: DUE, pointsTotal: 10 });
  const rowOf = (id: string) => groups.flatMap((g) => g.rows).find((r) => r.student.id === id)!;

  it("averages each category over submitted teammates", () => {
    const b = rowOf("b");
    expect(b.categories.map((c) => c.avg)).toEqual([3, 3]);
    expect(b.categories[0].n).toBe(2);
    expect(b.categories[0].self).toBe(5);
    expect(b.overall).toBe(3);
  });

  it("flags the late submitter and takes their points", () => {
    expect(rowOf("c").late).toBe(true);
    expect(rowOf("c").grade).toBe(8);
    expect(rowOf("a").grade).toBe(10);
  });

  it("puts someone on no team in a group of their own", () => {
    expect(groups.map((g) => g.team?.id ?? null)).toEqual(["t1", null]);
    expect(rowOf("d").grade).toBe(0);
    expect(rowOf("d").overall).toBeNull();
  });
});

describe("the student form", () => {
  it("sends only what's been filled in", () => {
    const draft = draftFrom([rate("a", "b", "c1", 4, " why ")], []);
    draft.ratings.b.c2 = { score: null, reason: "" };
    draft.comments.b = { qp: "  ", qs: "x" };
    expect(draftPayload(draft)).toEqual({
      ratings: [{ category_id: "c1", ratee_id: "b", score: 4, reason: "why" }],
      comments: [{ question_id: "qs", subject_id: "b", body: "x" }],
    });
  });
});

describe("reasons", () => {
  it("asks for one with every score, only 1s and 2s, or never", () => {
    expect([1, 2, 3, 5].map((n) => reasonNeeded("all", n))).toEqual([true, true, true, true]);
    expect([1, 2, 3, 5].map((n) => reasonNeeded("low", n))).toEqual([true, true, false, false]);
    expect([1, 5].map((n) => reasonNeeded("none", n))).toEqual([false, false]);
    expect(reasonNeeded("all", null)).toBe(false);
  });
});

describe("the form by category", () => {
  const categories = [cat("c1", 0), cat("c2", 1)];
  const questions = [q("qp", "peer"), q("qs", "self")];
  const people = [
    { student_id: "a", is_me: true },
    { student_id: "b", is_me: false },
  ];

  it("is one step per category, then comments, then reflection", () => {
    const steps = stepsFor({ categories, questions, settings: { peer_comments: true } });
    expect(steps.map((s) => (s.kind === "category" ? s.category.id : s.kind))).toEqual(["c1", "c2", "comments", "reflection"]);
    const noPeer = stepsFor({ categories, questions, settings: { peer_comments: false } });
    expect(noPeer.map((s) => s.kind)).toEqual(["category", "category", "reflection"]);
  });

  it("counts what's left on a step for everyone on it", () => {
    const steps = stepsFor({ categories, questions, settings: { peer_comments: true } });
    // a rated themselves 4 with no reason, b a 2 with no reason.
    const draft = draftFrom([rate("a", "a", "c1", 4), rate("a", "b", "c1", 2)], []);
    expect(leftInStep(steps[0], draft, people, { reasons: "low" })).toBe(1); // b's 2 needs a reason
    expect(leftInStep(steps[0], draft, people, { reasons: "all" })).toBe(2);
    expect(leftInStep(steps[0], draft, people, { reasons: "none" })).toBe(0);
    expect(leftInStep(steps[1], draft, people, { reasons: "low" })).toBe(2); // nobody rated in c2
    expect(leftInStep(steps[2], draft, people, { reasons: "low" })).toBe(1); // b's comment
    expect(leftInStep(steps[3], draft, people, { reasons: "low" })).toBe(1); // a's reflection
  });
});

