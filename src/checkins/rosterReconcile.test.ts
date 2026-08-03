import { describe, expect, it } from "vitest";
import { parseRoster } from "@/checkins/rosterImport";
import { reconcileRoster, type RosterRowLike } from "@/checkins/rosterReconcile";

// Exercises the reconcile the import preview actually uses, not a copy of it.
const row = (id: string, name: string, email: string | null = null): RosterRowLike => ({
  id,
  name,
  email,
});

const run = (roster: RosterRowLike[], fileText: string) =>
  reconcileRoster(roster, parseRoster(fileText).students);

describe("re-uploading a roster to add emails", () => {
  const namesOnly = [row("1", "Ada Lovelace"), row("2", "Grace Hopper")];
  const withEmails = "Name,Email\nAda Lovelace,ada@harvard.edu\nGrace Hopper,grace@harvard.edu";

  it("fills in every missing email without duplicating anyone", () => {
    const r = run(namesOnly, withEmails);
    expect(r.fresh).toHaveLength(0);
    expect(r.emailFills.map((f) => [f.student.id, f.email])).toEqual([
      ["1", "ada@harvard.edu"],
      ["2", "grace@harvard.edu"],
    ]);
  });

  it("handles a mixed file: new students AND back-filled emails", () => {
    const r = run(namesOnly, withEmails + "\nAlan Turing,alan@harvard.edu");
    expect(r.fresh.map((s) => s.name)).toEqual(["Alan Turing"]);
    expect(r.emailFills).toHaveLength(2);
  });

  it("never overwrites an address that is already set", () => {
    const r = run([row("1", "Ada Lovelace", "old@harvard.edu")], withEmails);
    expect(r.emailFills).toHaveLength(0);
    expect(r.unchanged).toBe(1);
  });

  it("still skips a plain duplicate with no new information", () => {
    const r = run(namesOnly, "Ada Lovelace\nGrace Hopper");
    expect(r.fresh).toHaveLength(0);
    expect(r.emailFills).toHaveLength(0);
    expect(r.unchanged).toBe(2);
  });

  it("treats re-importing the very same file as no change at all", () => {
    const roster = [row("1", "Ada Lovelace", "ada@harvard.edu"), row("2", "Grace Hopper", "grace@harvard.edu")];
    expect(run(roster, withEmails)).toEqual({ fresh: [], emailFills: [], unchanged: 2 });
  });

  it("matches on email even when the name is written differently", () => {
    const r = run([row("1", "Ada B Lovelace", "ada@harvard.edu")], "Name,Email\nAda Lovelace,ada@harvard.edu");
    expect(r.fresh).toHaveLength(0);
    expect(r.unchanged).toBe(1);
  });

  it("adds everyone when the roster is empty", () => {
    const r = run([], withEmails);
    expect(r.fresh).toHaveLength(2);
    expect(r.unchanged).toBe(0);
  });
});

describe("two students who share a name", () => {
  it("adds the second one instead of merging them into one row", () => {
    // The roster has one John Smith with no address; the file has two. Matching
    // both to the single row would lose a student and hand the survivor the
    // wrong address.
    const r = run(
      [row("1", "John Smith")],
      "Name,Email\nJohn Smith,john1@harvard.edu\nJohn Smith,john2@harvard.edu",
    );
    expect(r.emailFills.map((f) => [f.student.id, f.email])).toEqual([["1", "john1@harvard.edu"]]);
    expect(r.fresh.map((s) => s.email)).toEqual(["john2@harvard.edu"]);
  });

  it("leaves both rows alone once they are each linked", () => {
    const roster = [
      row("1", "John Smith", "john1@harvard.edu"),
      row("2", "John Smith", "john2@harvard.edu"),
    ];
    const r = run(roster, "Name,Email\nJohn Smith,john1@harvard.edu\nJohn Smith,john2@harvard.edu");
    expect(r).toEqual({ fresh: [], emailFills: [], unchanged: 2 });
  });

  it("does not let one row absorb two incoming students", () => {
    const r = run([row("1", "John Smith")], "John Smith\nJohn Smith");
    // parseRoster collapses a genuine repeat with no distinguishing address.
    expect(r.fresh.length + r.emailFills.length).toBe(0);
  });
});
