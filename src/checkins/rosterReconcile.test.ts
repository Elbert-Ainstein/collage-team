import { describe, expect, it } from "vitest";
import { parseRoster } from "@/checkins/rosterImport";

// Mirrors the reconcile logic in RosterEditor: new students vs emails to fill.
function reconcile(
  roster: { id: string; name: string; email: string | null }[],
  fileText: string,
) {
  const { students } = parseRoster(fileText);
  const byName = new Map(roster.map((s) => [s.name.trim().toLowerCase(), s]));
  const fresh = students.filter((s) => !byName.has(s.name.trim().toLowerCase()));
  const emailFills = students.flatMap((p) => {
    const m = byName.get(p.name.trim().toLowerCase());
    return m && p.email && !m.email ? [{ id: m.id, email: p.email }] : [];
  });
  return { fresh, emailFills, unchanged: students.length - fresh.length - emailFills.length };
}

describe("re-uploading a roster to add emails", () => {
  const namesOnly = [
    { id: "1", name: "Ada Lovelace", email: null },
    { id: "2", name: "Grace Hopper", email: null },
  ];
  const withEmails = "Name,Email\nAda Lovelace,ada@harvard.edu\nGrace Hopper,grace@harvard.edu";

  it("fills in every missing email without duplicating anyone", () => {
    const r = reconcile(namesOnly, withEmails);
    expect(r.fresh).toHaveLength(0);
    expect(r.emailFills).toEqual([
      { id: "1", email: "ada@harvard.edu" },
      { id: "2", email: "grace@harvard.edu" },
    ]);
  });

  it("handles a mixed file: new students AND back-filled emails", () => {
    const r = reconcile(namesOnly, withEmails + "\nAlan Turing,alan@harvard.edu");
    expect(r.fresh.map((s) => s.name)).toEqual(["Alan Turing"]);
    expect(r.emailFills).toHaveLength(2);
  });

  it("never overwrites an address that is already set", () => {
    const already = [{ id: "1", name: "Ada Lovelace", email: "old@harvard.edu" }];
    const r = reconcile(already, withEmails);
    expect(r.emailFills).toHaveLength(0);
    expect(r.unchanged).toBe(1);
  });

  it("still skips a plain duplicate with no new information", () => {
    const r = reconcile(namesOnly, "Ada Lovelace\nGrace Hopper");
    expect(r.fresh).toHaveLength(0);
    expect(r.emailFills).toHaveLength(0);
    expect(r.unchanged).toBe(2);
  });
});
