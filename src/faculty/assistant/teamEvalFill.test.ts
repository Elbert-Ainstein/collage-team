// Putting a fill_team_eval draft into the builder's form: what changes, what
// is said about it, and what the form's locks keep out.

import { describe, expect, it } from "vitest";
import type { TeamEvalProposal } from "@/assistant/types";
import { fillForm, formContext, localStamp, type TeamEvalForm } from "./teamEvalFill";

let n = 0;
const newId = () => `new-${++n}`;

const form = (): TeamEvalForm => ({
  title: "test",
  instructions: "",
  due: "",
  categories: [
    { id: "c1", name: "Contribution", levels: ["Rarely", "Some", "Share", "Well", "Beyond"] },
    { id: "c2", name: "Respect", levels: ["Dismisses", "Talks over", "Respectful", "Encourages", "Builds trust"] },
  ],
  questions: [
    { id: "q1", audience: "peer", prompt: "One thing they do well" },
    { id: "q2", audience: "peer", prompt: "One thing to work on" },
    { id: "q3", audience: "self", prompt: "How did you contribute?" },
  ],
  peerComments: true,
  releaseComments: true,
  anonymize: true,
  lateOn: true,
  latePoints: "2",
});

const draft = (over: Partial<TeamEvalProposal>): TeamEvalProposal => ({
  kind: "teameval",
  summary: "x",
  title: null,
  instructions: null,
  due: null,
  categories: null,
  questions: null,
  peerComments: null,
  releaseComments: null,
  anonymize: null,
  lateOn: null,
  latePoints: null,
  notApplied: [],
  ...over,
});

const open = { fixed: false, anonLocked: false };

describe("fillForm", () => {
  it("changes only the late penalty when that is all the draft says", () => {
    const before = form();
    const out = fillForm(before, draft({ latePoints: 3 }), open, newId);
    expect(out.next).toEqual({ ...before, latePoints: "3" });
    expect(out.changes).toEqual(["Late penalty 2 → 3 pts"]);
    expect(out.skipped).toEqual([]);
    expect(out.showForm).toBe(true);
    // The form it was given is left as it was.
    expect(before.latePoints).toBe("2");
  });

  it("turns the late penalty off, keeping its points for when it's back on", () => {
    const out = fillForm(form(), draft({ lateOn: false }), open, newId);
    expect(out.next).toMatchObject({ lateOn: false, latePoints: "2" });
    expect(out.changes).toEqual(["Late penalty off"]);
  });

  it("turns the penalty on when she asks for points off while it's off", () => {
    const off = { ...form(), lateOn: false };
    const out = fillForm(off, draft({ latePoints: 4 }), open, newId);
    expect(out.next).toMatchObject({ lateOn: true, latePoints: "4" });
    expect(out.changes).toEqual(["Late penalty on", "Late penalty 2 → 4 pts"]);
    // Zero points off isn't asking for a penalty.
    expect(fillForm(off, draft({ latePoints: 0 }), open, newId).next.lateOn).toBe(false);
  });

  it("says nothing changed when the draft repeats what the form already says", () => {
    const out = fillForm(form(), draft({ latePoints: 2, lateOn: true, anonymize: true }), open, newId);
    expect(out.changes).toEqual([]);
  });

  it("fills a whole rubric from a document, keeping the rows it replaces", () => {
    const five = ["Contributing", "Interacting", "On Track", "Quality", "Knowledge"];
    const out = fillForm(
      form(),
      draft({
        categories: five.map((name) => ({ name, levels: ["1", "2", "3", "4", "5"] })),
        questions: [
          { audience: "peer", prompt: "What helped?" },
          { audience: "peer", prompt: "What could they strengthen?" },
          { audience: "self", prompt: "How did you contribute?" },
          { audience: "self", prompt: "What will you do differently?" },
        ],
        instructions: "Rate each teammate.",
      }),
      open,
      newId,
    );
    expect(out.next.categories.map((c) => c.id)).toEqual(["c1", "c2", "new-1", "new-2", "new-3"]);
    expect(out.next.questions.map((q) => [q.id, q.audience])).toEqual([
      ["q1", "peer"],
      ["q2", "peer"],
      ["q3", "self"],
      ["new-4", "self"],
    ]);
    expect(out.changes).toEqual([
      "Instructions",
      "5 categories: Contributing, Interacting, On Track, Quality, Knowledge",
      "Teammate questions reworded",
      "Self-reflection questions 1 → 2",
    ]);
  });

  it("keeps the note to the instructor on its own row when the draft rewords it", () => {
    const withNote = { ...form(), questions: [...form().questions, { id: "q4", audience: "instructor" as const, prompt: "Anything else?" }] };
    const out = fillForm(
      withNote,
      draft({ questions: [...withNote.questions.map(({ audience, prompt }) => ({ audience, prompt })).slice(0, 3), { audience: "instructor", prompt: "Anything for me?" }] }),
      open,
      newId,
    );
    expect(out.next.questions.map((q) => [q.id, q.audience])).toEqual([
      ["q1", "peer"],
      ["q2", "peer"],
      ["q3", "self"],
      ["q4", "instructor"],
    ]);
    expect(out.changes).toEqual(["Notes to the instructor reworded"]);
  });

  it("names a renamed category and counts reworded descriptions", () => {
    const before = form();
    const out = fillForm(
      before,
      draft({
        categories: [
          { name: "Contribution", levels: ["Rarely", "Some", "Share", "Well done", "Far beyond"] },
          { name: "Interacting with Teammates", levels: before.categories[1].levels },
        ],
      }),
      open,
      newId,
    );
    expect(out.changes).toEqual(["Contribution: 2 descriptions reworded", "Respect → Interacting with Teammates"]);
  });

  it("reports switches and the title only when they change", () => {
    const out = fillForm(
      form(),
      draft({ title: "AP50 Teamwork Evaluation", peerComments: false, releaseComments: true, anonymize: false }),
      open,
      newId,
    );
    expect(out.changes).toEqual(["Title “AP50 Teamwork Evaluation”", "Evaluate peer to peer off", "Anonymize off"]);
  });

  it("writes a due date the way the instructor reads one", () => {
    const out = fillForm(form(), draft({ due: "2026-11-21T17:00" }), open, newId);
    expect(out.next.due).toBe("2026-11-21T17:00");
    expect(out.changes).toEqual(["Due Sat, Nov 21, 5:00 PM"]);
    // A date alone is on the first step; no need to jump to the categories.
    expect(out.showForm).toBe(false);
  });

  it("keeps anonymity on once students have written under it", () => {
    const out = fillForm(form(), draft({ anonymize: false, latePoints: 3 }), { fixed: true, anonLocked: true }, newId);
    expect(out.next.anonymize).toBe(true);
    expect(out.next.latePoints).toBe("3");
    expect(out.skipped).toEqual(["Anonymize stays on: students wrote under it"]);
  });

  it("adds and removes nothing once students have submitted — rewording only", () => {
    const locked = { fixed: true, anonLocked: false };
    const before = form();
    const added = fillForm(
      before,
      draft({ categories: [...before.categories, { name: "Quality", levels: ["", "", "", "", ""] }] }),
      locked,
      newId,
    );
    expect(added.next.categories).toEqual(before.categories);
    expect(added.skipped).toEqual(["Categories: students have submitted, so none can be added or removed"]);

    const reworded = fillForm(
      before,
      draft({
        questions: [
          { audience: "peer", prompt: "One specific thing they did well" },
          { audience: "peer", prompt: "One thing to work on" },
          { audience: "self", prompt: "How did you contribute?" },
        ],
      }),
      locked,
      newId,
    );
    expect(reworded.next.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(reworded.next.questions[0].prompt).toBe("One specific thing they did well");
    expect(reworded.skipped).toEqual([]);

    const moved = fillForm(
      before,
      draft({
        questions: [
          { audience: "self", prompt: "How did you contribute?" },
          { audience: "peer", prompt: "One thing they do well" },
          { audience: "peer", prompt: "One thing to work on" },
        ],
      }),
      locked,
      newId,
    );
    expect(moved.next.questions).toEqual(before.questions);
    expect(moved.skipped).toEqual(["Questions: students have submitted, so none can be added, removed or moved"]);
  });
});

describe("formContext", () => {
  it("describes the form to the model without its row ids, with her local time", () => {
    const ctx = formContext(form(), { fixed: false, anonLocked: false }, new Date(2026, 10, 20, 9, 5));
    expect(ctx).toMatchObject({ kind: "teameval", now: "2026-11-20T09:05", lateOn: true, latePoints: "2", fixed: false });
    expect(ctx.categories[0]).toEqual({ name: "Contribution", levels: ["Rarely", "Some", "Share", "Well", "Beyond"] });
    expect(JSON.stringify(ctx)).not.toContain('"id"');
  });

  it("pads every part of the time", () => {
    expect(localStamp(new Date(2027, 0, 3, 7, 4))).toBe("2027-01-03T07:04");
  });
});

describe("revertFill", () => {
  it("puts back only what the fill changed, keeping what she typed since", async () => {
    const { revertFill } = await import("./teamEvalFill");
    const before = form();
    const fill = fillForm(before, draft({ latePoints: 3, anonymize: true }), open, newId);
    expect(fill.fields).toEqual(["latePoints"]);
    // She renames a category after the fill…
    const since = { ...fill.next, categories: [{ ...fill.next.categories[0], name: "Contributing" }, fill.next.categories[1]] };
    const undone = revertFill(since, before, fill.fields);
    expect(undone.latePoints).toBe("2");
    expect(undone.categories[0].name).toBe("Contributing");
  });

  it("records no field for a part the locks kept out", () => {
    const before = form();
    const fill = fillForm(
      before,
      draft({ categories: [...before.categories, { name: "Quality", levels: ["", "", "", "", ""] }] }),
      { fixed: true, anonLocked: false },
      newId,
    );
    expect(fill.fields).toEqual([]);
  });
});
