// fill_team_eval: what the model may send back, and what reaches the form.
//
// Strict where a half-read draft would fill the form wrongly (a level with no
// score, a penalty of 140%), forgiving where models habitually pad (blank
// optional fields, levels out of order).

import { describe, expect, it } from "vitest";
import { FILL_TEAM_EVAL, parseFillTeamEval } from "./teamEvalTool";

const levels = (name: string) => [5, 4, 3, 2, 1].map((score) => ({ score, text: `${name} ${score}` }));

describe("parseFillTeamEval", () => {
  it("reads a one-setting change as that change and nothing else", () => {
    const out = parseFillTeamEval({ summary: "Sets the late penalty to 20%.", late_penalty: 20 });
    expect(out).toEqual({
      kind: "teameval",
      summary: "Sets the late penalty to 20%.",
      title: null,
      instructions: null,
      due: null,
      categories: null,
      questions: null,
      peerComments: null,
      releaseComments: null,
      anonymize: null,
      latePenalty: 20,
      notApplied: [],
    });
  });

  it("puts levels in score order whatever order they came in", () => {
    const out = parseFillTeamEval({
      summary: "Fills in the rubric.",
      categories: [{ name: "Contributing to the Team's Work", levels: levels("C") }],
    });
    expect(out.categories).toEqual([
      { name: "Contributing to the Team's Work", levels: ["C 1", "C 2", "C 3", "C 4", "C 5"] },
    ]);
  });

  it("leaves a score the document did not describe empty, not invented", () => {
    const out = parseFillTeamEval({
      summary: "x",
      categories: [{ name: "Quality", levels: [{ score: 1, text: "Low" }, { score: 3, text: "Mid" }, { score: 5, text: "High" }] }],
    });
    expect(out.categories?.[0].levels).toEqual(["Low", "", "Mid", "", "High"]);
  });

  it("keeps questions in order with their audience", () => {
    const out = parseFillTeamEval({
      summary: "x",
      questions: [
        { audience: "peer", prompt: "  One thing that helped  " },
        { audience: "self", prompt: "One thing to improve" },
        { audience: "instructor", prompt: "Anything for your instructor?" },
      ],
    });
    expect(out.questions).toEqual([
      { audience: "peer", prompt: "One thing that helped" },
      { audience: "self", prompt: "One thing to improve" },
      { audience: "instructor", prompt: "Anything for your instructor?" },
    ]);
  });

  it("reads switches, title, instructions and a due date", () => {
    const out = parseFillTeamEval({
      summary: "x",
      title: "AP50 Teamwork Evaluation",
      instructions: "Rate each teammate.\n\n- 3 means meets expectations.",
      due: "2026-11-21T17:00",
      peer_comments: true,
      release_comments: false,
      anonymize: true,
      not_applied: ["A “Not enough information” choice"],
    });
    expect(out).toMatchObject({
      title: "AP50 Teamwork Evaluation",
      instructions: "Rate each teammate.\n\n- 3 means meets expectations.",
      due: "2026-11-21T17:00",
      peerComments: true,
      releaseComments: false,
      anonymize: true,
      notApplied: ["A “Not enough information” choice"],
    });
  });

  it("treats blank optional fields as left alone", () => {
    const out = parseFillTeamEval({ summary: "x", title: "  ", instructions: "", due: "", late_penalty: null, anonymize: false });
    expect(out).toMatchObject({ title: null, instructions: null, due: null, latePenalty: null, anonymize: false });
  });

  it.each([
    [{ late_penalty: 140 }, "late penalty"],
    [{ late_penalty: -5 }, "late penalty"],
    [{ due: "next Friday" }, "due date"],
    [{ due: "2026-02-31T17:00" }, "due date"],
    [{ categories: [] }, "category"],
    [{ categories: [{ name: "", levels: levels("x") }] }, "name"],
    [{ categories: [{ name: "A", levels: [{ score: 6, text: "x" }] }] }, "score"],
    [{ categories: [{ name: "A", levels: [{ score: 2, text: "a" }, { score: 2, text: "b" }] }] }, "twice"],
    [{ questions: [{ audience: "staff", prompt: "x" }] }, "audience"],
    [{ questions: [{ audience: "peer", prompt: " " }] }, "empty"],
    [{ anonymize: "yes" }, "anonymize"],
  ])("refuses %j", (extra, why) => {
    expect(() => parseFillTeamEval({ summary: "x", ...extra })).toThrow(new RegExp(why, "i"));
  });

  it("refuses a draft with no summary", () => {
    expect(() => parseFillTeamEval({ late_penalty: 20 })).toThrow(/summary/);
  });

  it("refuses a draft that changes nothing", () => {
    expect(() => parseFillTeamEval({ summary: "Nothing to do." })).toThrow(/changes nothing/);
  });

  it("refuses names and levels past what the builder keeps", () => {
    expect(() => parseFillTeamEval({ summary: "x", categories: [{ name: "n".repeat(121), levels: levels("x") }] })).toThrow(
      /120/,
    );
    expect(() =>
      parseFillTeamEval({ summary: "x", categories: [{ name: "A", levels: [{ score: 1, text: "w".repeat(2001) }] }] }),
    ).toThrow(/2,000/);
  });
});

describe("FILL_TEAM_EVAL", () => {
  it("uses only schema features every provider accepts", () => {
    const json = JSON.stringify(FILL_TEAM_EVAL.schema);
    expect(json).not.toMatch(/oneOf|anyOf|allOf|\$ref/);
    expect(FILL_TEAM_EVAL.schema.required).toEqual(["summary"]);
  });
});
