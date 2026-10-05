// What the model is told. The snapshot is the model's only view of the class,
// so these pin that every student appears with a ref, that the students on no
// team are named as such, and that nothing in a name can break the layout the
// instructions refer to.

import { describe, expect, it } from "vitest";
import { conversation, renderSnapshot, systemPrompt } from "./prompt";
import type { Snapshot } from "./types";

const snapshot: Snapshot = {
  course: { name: "Applied Physics 50", code: "AP50A", term: "Fall" },
  students: [
    { ref: "s1", name: "Ada Lovelace", email: "ada@x.edu" },
    { ref: "s2", name: "Alan Turing", email: null },
    { ref: "s3", name: "Grace\nHopper", email: "grace@x.edu" },
  ],
  teams: [
    { ref: "t1", name: "Team 1", members: ["s1"] },
    { ref: "t2", name: "Team Helix", members: [] },
  ],
};

describe("renderSnapshot", () => {
  const out = renderSnapshot(snapshot);

  it("names the course", () => {
    expect(out).toContain("Applied Physics 50 (AP50A, Fall)");
  });

  it("lists each team with its ref and its members", () => {
    expect(out).toContain('t1 "Team 1" — 1 student: s1 Ada Lovelace <ada@x.edu>');
    expect(out).toContain('t2 "Team Helix" — nobody');
  });

  it("names the students on no team, and says when one has no email", () => {
    expect(out).toMatch(/Not on any team \(2\):/);
    expect(out).toContain("s2 Alan Turing (no email)");
  });

  it("flattens a newline inside a name so it cannot start a line of its own", () => {
    expect(out).toContain("s3 Grace Hopper <grace@x.edu>");
  });

  it("says plainly when there are no teams yet", () => {
    expect(renderSnapshot({ ...snapshot, teams: [] })).toContain("No teams yet.");
  });
});

describe("systemPrompt", () => {
  it("carries the rules and the snapshot", () => {
    const out = systemPrompt(snapshot);
    expect(out).toContain("Nothing you propose is written");
    expect(out).toContain('t1 "Team 1"');
    expect(out).not.toContain("Attached file");
  });

  it("describes an attached file by its columns, with no student in it", () => {
    const out = systemPrompt(snapshot, {
      name: "class.csv",
      rows: 80,
      columns: [
        { name: "Name", kind: "text", filled: 80, distinct: 80, looksLike: "name" },
        { name: "Gender", kind: "category", filled: 80, distinct: 3, values: [{ value: "F", count: 38 }, { value: "M", count: 37 }, { value: "NB", count: 5 }] },
        { name: "Pre-class assessment", kind: "number", filled: 78, distinct: 60, min: 30, max: 100, mean: 64 },
      ],
    });
    expect(out).toContain("Attached file: class.csv (80 rows)");
    expect(out).toContain('"Gender": category — F 38, M 37, NB 5');
    expect(out).toContain('"Pre-class assessment": number from 30 to 100, average 64 (78 of 80 filled)');
    expect(out).toContain('"Name": text, looks like names');
  });
});

describe("conversation", () => {
  it("ends with the new message from the instructor", () => {
    const turns = conversation([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }], "next");
    expect(turns.at(-1)).toEqual({ role: "user", text: "next" });
    expect(turns).toHaveLength(3);
  });

  it("drops assistant turns before the first instructor turn", () => {
    const turns = conversation([{ role: "assistant", text: "Welcome." }], "Move Ada");
    expect(turns).toEqual([{ role: "user", text: "Move Ada" }]);
  });

  it("merges two turns in a row from the same side", () => {
    const turns = conversation(
      [
        { role: "user", text: "Move Ada" },
        { role: "assistant", text: "Drafted." },
        { role: "assistant", text: "Applied." },
      ],
      "Thanks",
    );
    expect(turns).toEqual([
      { role: "user", text: "Move Ada" },
      { role: "assistant", text: "Drafted.\n\nApplied." },
      { role: "user", text: "Thanks" },
    ]);
  });
});
