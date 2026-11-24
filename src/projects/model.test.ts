import { describe, expect, it } from "vitest";
import {
  earlierReasons,
  fmt,
  graderLabel,
  leftText,
  nothingLeft,
  progressOf,
  resultsRows,
  slotsFor,
  stateOf,
  teamResult,
  toProjectCsv,
  whatsLeft,
  type Draft,
} from "./model";
import { problemWith, defaultCategories } from "./defaults";
import type { ProjectCategory, ProjectGrading, ProjectScore, ProjectSnapshot } from "./types";

const cat = (id: string, name: string, position = 0): ProjectCategory => ({
  id,
  project_id: "p",
  position,
  name,
  levels: ["1", "2", "3", "4", "5"],
  created_at: "",
});

const grading = (team: string, slot: number, extra: Partial<ProjectGrading> = {}): ProjectGrading => ({
  project_id: "p",
  team_id: team,
  slot,
  grader_name: "",
  done_at: null,
  updated_by: null,
  updated_at: "",
  ...extra,
});

const score = (
  team: string,
  slot: number,
  category: string,
  value: number | null,
  reason = "",
  at = "2026-01-01T00:00:00Z",
): ProjectScore => ({
  project_id: "p",
  team_id: team,
  slot,
  category_id: category,
  score: value,
  reason,
  updated_at: at,
});

const project = { id: "p", graders_per_team: 2 };

describe("grader slots", () => {
  it("shows as many as the project asks for, and any used past that", () => {
    expect(slotsFor(project, [], "t1")).toEqual([1, 2]);
    expect(slotsFor(project, [grading("t1", 4)], "t1")).toEqual([1, 2, 3, 4]);
    expect(slotsFor(project, [grading("t2", 4)], "t1")).toEqual([1, 2]);
  });

  it("is empty, started or done", () => {
    expect(stateOf(undefined)).toBe("empty");
    expect(stateOf(grading("t1", 1))).toBe("started");
    expect(stateOf(grading("t1", 1, { done_at: "2026-01-01" }))).toBe("done");
  });

  it("is called by its grader's name once it has one", () => {
    expect(graderLabel(undefined, 2)).toBe("Grader 2");
    expect(graderLabel(grading("t1", 2, { grader_name: "  " }), 2)).toBe("Grader 2");
    expect(graderLabel(grading("t1", 2, { grader_name: "Will" }), 2)).toBe("Will");
  });
});

describe("what's left before done", () => {
  const cats = [cat("r", "Robustness"), cat("t", "Time"), cat("d", "Design")];
  const drafts = (entries: [string, Draft][]) => new Map(entries);

  it("needs a name, a score and a reason in every category", () => {
    const left = whatsLeft(cats, drafts([["r", { score: 5, reason: "" }]]), "");
    expect(left).toEqual({ name: true, unscored: ["t", "d"], unexplained: ["r"] });
    expect(nothingLeft(left)).toBe(false);
    expect(leftText(left, cats)).toBe("Add your name · Score Time and Design · Say why for Robustness");
  });

  it("counts a reason with no score as unscored, and whitespace as nothing", () => {
    const left = whatsLeft(
      cats,
      drafts([
        ["r", { score: null, reason: "fast" }],
        ["t", { score: 3, reason: "   " }],
        ["d", { score: 4, reason: "ok" }],
      ]),
      "Will",
    );
    expect(left).toEqual({ name: false, unscored: ["r"], unexplained: ["t"] });
  });

  it("is nothing once it's all there", () => {
    const all = drafts(cats.map((c) => [c.id, { score: 4, reason: "fine" }]));
    const left = whatsLeft(cats, all, "Will");
    expect(nothingLeft(left)).toBe(true);
    expect(leftText(left, cats)).toBeNull();
  });

  it("names a long list by its length", () => {
    expect(leftText(whatsLeft(cats, new Map(), "Will"), cats)).toBe("Score 3 categories");
  });
});

describe("a team's result", () => {
  const cats = [cat("r", "Robustness"), cat("t", "Time")];
  const snap = (gradings: ProjectGrading[], scores: ProjectScore[]) => ({ categories: cats, gradings, scores });

  it("averages each category over the done gradings only", () => {
    const r = teamResult(
      snap(
        [grading("t1", 1, { done_at: "x" }), grading("t1", 2, { done_at: "x" }), grading("t1", 3)],
        [
          score("t1", 1, "r", 5),
          score("t1", 1, "t", 3),
          score("t1", 2, "r", 4),
          score("t1", 2, "t", 4),
          // In progress: left out.
          score("t1", 3, "r", 1),
          score("t1", 3, "t", 1),
          // Another team.
          score("t2", 1, "r", 1),
        ],
      ),
      "t1",
    );
    expect(r.graders).toBe(2);
    expect(r.byCategory.get("r")).toBe(4.5);
    expect(r.byCategory.get("t")).toBe(3.5);
    expect(r.total).toBe(8);
  });

  it("has no total until a grading is done", () => {
    const r = teamResult(snap([grading("t1", 1)], [score("t1", 1, "r", 5)]), "t1");
    expect(r.graders).toBe(0);
    expect(r.total).toBeNull();
    expect(r.byCategory.get("r")).toBeNull();
  });

  it("prints at most two places", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(17.5)).toBe("17.5");
    expect(fmt(10 / 3)).toBe("3.33");
    expect(fmt(18)).toBe("18");
  });
});

describe("reasons given before", () => {
  const gradings = [
    grading("t1", 1, { grader_name: "Will" }),
    grading("t2", 1, { grader_name: "will " }),
    grading("t3", 2, { grader_name: "Kelly" }),
    grading("t4", 1, { grader_name: "Will" }),
  ];
  const scores = [
    score("t2", 1, "r", 5, "7 parts, cool pulley that actuates", "2026-01-01T10:00:00Z"),
    score("t3", 2, "r", 3, "Wobbled twice", "2026-01-01T11:00:00Z"),
    score("t3", 2, "r", 4, "Solid build", "2026-01-01T12:00:00Z"),
    // The same words again, from Kelly: one chip.
    score("t3", 2, "x", 4, "Elsewhere", "2026-01-01T12:00:00Z"),
    // This sheet's own reason: never offered back.
    score("t1", 1, "r", 5, "Mine right now", "2026-01-01T13:00:00Z"),
    score("t4", 1, "r", null, "   ", "2026-01-01T14:00:00Z"),
  ];
  const base = { categoryId: "r", teamId: "t1", slot: 1, graderName: "Will", score: null, current: "" };

  it("offers this category's reasons, the grader's own first", () => {
    const got = earlierReasons(scores, gradings, base);
    expect(got.map((r) => r.reason)).toEqual([
      "7 parts, cool pulley that actuates",
      "Solid build",
      "Wobbled twice",
    ]);
    expect(got[0].mine).toBe(true);
    expect(got[1].mine).toBe(false);
  });

  it("puts ones given with the same score next", () => {
    const got = earlierReasons(scores, gradings, { ...base, graderName: "Someone", score: 3 });
    expect(got.map((r) => r.reason)).toEqual([
      "Wobbled twice",
      "Solid build",
      "7 parts, cool pulley that actuates",
    ]);
  });

  it("leaves out what the box already says, and duplicates", () => {
    const dupes = [...scores, score("t3", 2, "r", 3, "  wobbled   TWICE ", "2026-01-01T09:00:00Z")];
    const got = earlierReasons(dupes, gradings, { ...base, current: "Solid build" });
    expect(got.map((r) => r.reason)).toEqual(["7 parts, cool pulley that actuates", "Wobbled twice"]);
  });

  it("stops at the limit", () => {
    expect(earlierReasons(scores, gradings, { ...base, limit: 1 })).toHaveLength(1);
  });
});

describe("progress", () => {
  it("counts done gradings, ones in progress, and teams with enough done", () => {
    const gradings = [
      grading("t1", 1, { done_at: "x" }),
      grading("t1", 2, { done_at: "x" }),
      grading("t2", 1, { done_at: "x" }),
      grading("t2", 2),
      grading("t9", 1, { done_at: "x" }),
      { ...grading("t1", 3, { done_at: "x" }), project_id: "other" },
    ];
    expect(progressOf(gradings, project, ["t1", "t2", "t3"])).toEqual({ done: 3, started: 1, teamsComplete: 1 });
  });
});

describe("the results spreadsheet", () => {
  it("has a row per team with averages, the total and every done grader's reasons", () => {
    const cats = [cat("r", "Robustness"), cat("t", "Time", 1)];
    const snap: ProjectSnapshot = {
      project: {
        id: "p",
        course_id: "c",
        title: "Fair",
        graders_per_team: 2,
        team_set_id: null,
        position: 0,
        created_at: "",
        updated_at: "",
      },
      categories: cats,
      gradings: [grading("t1", 1, { grader_name: "Will", done_at: "x" }), grading("t1", 2, { grader_name: "Kelly" })],
      scores: [
        score("t1", 1, "r", 5, "7 parts"),
        score("t1", 1, "t", 3, "-1 for the restart"),
        score("t1", 2, "r", 1, "draft"),
      ],
    };
    const rows = resultsRows(snap, [
      { id: "t1", name: "Team 1", members: [{ name: "Ada" }, { name: "Bo" }] },
      { id: "t2", name: "Team 2", members: [] },
    ]);
    expect(rows[0]).toEqual(["Team", "Members", "Graded by", "Robustness", "Time", "Total", "Out of", "Reasons"]);
    expect(rows[1]).toEqual([
      "Team 1",
      "Ada; Bo",
      "Will",
      5,
      3,
      8,
      10,
      "Will — Robustness 5: 7 parts; Time 3: -1 for the restart",
    ]);
    expect(rows[2]).toEqual(["Team 2", "", "", null, null, null, 10, ""]);

    const csv = toProjectCsv([["-1 for the restart", -1, "=SUM(A1)", 'say "hi"', null]]);
    expect(csv).toBe(`'-1 for the restart,-1,'=SUM(A1),"say ""hi""",\r\n`);
  });
});

describe("the editor's checks", () => {
  it("needs a title, 1–8 graders and named categories", () => {
    const cats = defaultCategories();
    expect(cats).toHaveLength(4);
    expect(new Set(cats.map((c) => c.id)).size).toBe(4);
    expect(cats.every((c) => c.levels.length === 5 && c.levels.every(Boolean))).toBe(true);
    expect(problemWith("", 2, cats)).toBe("Give the project a title");
    expect(problemWith("Fair", 0, cats)).toBe("Graders per team: 1 to 8");
    expect(problemWith("Fair", 2.5, cats)).toBe("Graders per team: 1 to 8");
    expect(problemWith("Fair", 2, [])).toBe("Add a category");
    expect(problemWith("Fair", 2, [...cats, { id: "x", name: " ", levels: [] }])).toBe("Category 5 needs a name");
    expect(problemWith("Fair", 2, cats)).toBeNull();
  });
});
