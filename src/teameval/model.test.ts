import { describe, expect, it } from "vitest";
import type { Student, TeamWithMembers } from "@/checkins/types";
import {
  buildResults,
  commentCell,
  draftFrom,
  draftPayload,
  fmtAvg,
  gradeFor,
  isLate,
  leftOn,
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
      explain_ratings: false,
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

describe("commentCell", () => {
  const snapshot = {
    categories: [cat("c1", 0)],
    questions: [q("qp", "peer"), q("qs", "self")],
    ratings: [rate("a", "b", "c1", 4, "steady"), rate("b", "b", "c1", 5)],
    comments: [
      { activity_id: "e", question_id: "qp", author_id: "a", subject_id: "b", body: "great notes", updated_at: "" },
      { activity_id: "e", question_id: "qs", author_id: "b", subject_id: "b", body: "I led", updated_at: "" },
    ],
    submissions: [sub("a", DUE)],
  };

  it("shows what one teammate wrote about another, with their scores", () => {
    const c = commentCell(snapshot, "a", "b");
    expect(c.submitted).toBe(true);
    expect(c.answers.map((x) => x.body)).toEqual(["great notes"]);
    expect(c.scores.map((x) => [x.score, x.reason])).toEqual([[4, "steady"]]);
  });

  it("shows the reflection on the diagonal", () => {
    const c = commentCell(snapshot, "b", "b");
    expect(c.self).toBe(true);
    expect(c.submitted).toBe(false);
    expect(c.answers.map((x) => x.body)).toEqual(["I led"]);
  });
});

describe("the student form", () => {
  const categories = [cat("c1", 0), cat("c2", 1)];
  const questions = [q("qp", "peer"), q("qs", "self")];
  const settings = { peer_comments: true, explain_ratings: true };

  it("counts what's left on a page the way submitting does", () => {
    const draft = draftFrom([rate("a", "b", "c1", 4, "why"), rate("a", "b", "c2", 3)], []);
    // c2 has no why, and the peer question is unanswered.
    expect(leftOn(draft, "b", false, categories, questions, settings)).toBe(2);
    expect(leftOn(draft, "b", false, categories, questions, { ...settings, explain_ratings: false })).toBe(1);
    expect(leftOn(draft, "b", false, categories, questions, { peer_comments: false, explain_ratings: false })).toBe(0);
    // Their own page asks the self question, not the peer one.
    expect(leftOn(draft, "a", true, categories, questions, settings)).toBe(3);
  });

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
