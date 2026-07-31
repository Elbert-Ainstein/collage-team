import { describe, expect, it } from "vitest";
import { mixableAttrs } from "./attrs";
import type { Student } from "./types";
import { isSupportedRosterFile, parseRoster } from "./rosterImport";

describe("parseRoster", () => {
  it("reads a plain list of names", () => {
    const { students } = parseRoster("Ada Lovelace\nGrace Hopper\nAlan Turing");
    expect(students.map((s) => s.name)).toEqual(["Ada Lovelace", "Grace Hopper", "Alan Turing"]);
  });

  it("reads a name column with a header and pulls emails", () => {
    const csv = ["Name,Email", "Ada Lovelace,ada@harvard.edu", "Grace Hopper,grace@harvard.edu"].join("\n");
    const { students } = parseRoster(csv);
    expect(students).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
      { name: "Grace Hopper", email: "grace@harvard.edu" },
    ]);
  });

  it("joins separate first/last columns", () => {
    const csv = ["First,Last,Email", "Ada,Lovelace,ada@harvard.edu"].join("\n");
    expect(parseRoster(csv).students[0]).toEqual({
      name: "Ada Lovelace",
      email: "ada@harvard.edu",
    });
  });

  it('flips "Last, First" into natural order', () => {
    const csv = ['"Lovelace, Ada"', '"Hopper, Grace"'].join("\n");
    expect(parseRoster(csv).students.map((s) => s.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("handles an LMS export with extra columns and quoted fields", () => {
    const csv = [
      "Student,ID,SIS Login ID,Section",
      '"Lovelace, Ada",1234,alovelace,AP50A',
      '"Hopper, Grace",1235,ghopper,AP50A',
    ].join("\n");
    const { students } = parseRoster(csv);
    expect(students.map((s) => s.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("reads tab-separated files", () => {
    const tsv = "Name\tEmail\nAda Lovelace\tada@harvard.edu";
    expect(parseRoster(tsv).students[0]).toEqual({
      name: "Ada Lovelace",
      email: "ada@harvard.edu",
    });
  });

  it("skips blank rows and de-duplicates", () => {
    const { students, warnings } = parseRoster("Ada Lovelace\n\nAda Lovelace\n\nGrace Hopper\n");
    expect(students.map((s) => s.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(warnings.join(" ")).toMatch(/duplicate/i);
  });

  it("does not mangle suffixed names", () => {
    expect(parseRoster('"King, Jr."').students[0].name).toBe("King, Jr.");
  });

  it("strips a BOM from an Excel-exported CSV", () => {
    const { students } = parseRoster("﻿Name\nAda Lovelace");
    expect(students.map((s) => s.name)).toEqual(["Ada Lovelace"]);
  });

  it("reports an empty file instead of throwing", () => {
    const { students, warnings } = parseRoster("   \n\n");
    expect(students).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/empty/i);
  });
});

describe("extra columns become mixable attributes", () => {
  const csv = [
    "Name,Email,Major,Skill tag",
    "Ada Lovelace,ada@x.edu,CS,Data",
    "Rosalind Franklin,ros@x.edu,Chemistry,Lab",
    "Barbara McClintock,barb@x.edu,Biology,Lab",
  ].join("\n");

  it("keeps the extra columns, keyed by lower-cased header", () => {
    const { students, attrKeys } = parseRoster(csv);
    expect(attrKeys).toEqual(["major", "skill tag"]);
    expect(students[0].attrs).toEqual({ major: "CS", "skill tag": "Data" });
  });

  it("says which attributes it kept", () => {
    expect(parseRoster(csv).warnings.join(" ")).toMatch(/mixable attributes: major, skill tag/i);
  });

  it("does not treat the name or email columns as attributes", () => {
    const { attrKeys } = parseRoster("Name,Email\nAda,ada@x.edu");
    expect(attrKeys).toEqual([]);
  });

  it("reports no attributes when a file has none", () => {
    const { students, attrKeys } = parseRoster("Name\nAda Lovelace\nRosalind Franklin");
    expect(attrKeys).toEqual([]);
    expect(students[0].attrs).toBeUndefined();
  });

  it("ignores blank cells rather than storing an empty attribute", () => {
    const { students } = parseRoster("Name,Major\nAda,\nRosalind,Chemistry");
    expect(students[0].attrs).toBeUndefined();
    expect(students[1].attrs).toEqual({ major: "Chemistry" });
  });

  it("skips attributes with no header — there is nothing to call them", () => {
    // No header row at all, so the extra column cannot be named.
    const { attrKeys } = parseRoster("Ada Lovelace,CS\nRosalind Franklin,Chemistry");
    expect(attrKeys).toEqual([]);
  });
});

describe("mixableAttrs", () => {
  const student = (name: string, attrs: Record<string, string>): Student => ({
    id: name,
    course_id: "c1",
    name,
    email: null,
    avatar_tint: null,
    attrs,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
  });

  it("offers an attribute that actually varies", () => {
    expect(
      mixableAttrs([student("A", { major: "CS" }), student("B", { major: "Biology" })]),
    ).toEqual(["major"]);
  });

  it("drops an attribute everyone shares — it cannot mix anything", () => {
    expect(
      mixableAttrs([student("A", { major: "CS" }), student("B", { major: "CS" })]),
    ).toEqual([]);
  });

  it("drops an attribute only one student carries", () => {
    expect(mixableAttrs([student("A", { major: "CS" }), student("B", {})])).toEqual([]);
  });

  it("ignores identifying columns", () => {
    expect(
      mixableAttrs([student("A", { email: "a@x.edu" }), student("B", { email: "b@x.edu" })]),
    ).toEqual([]);
  });
});

describe("isSupportedRosterFile", () => {
  it("accepts text roster formats and rejects workbooks", () => {
    expect(isSupportedRosterFile("roster.csv")).toBe(true);
    expect(isSupportedRosterFile("roster.TSV")).toBe(true);
    expect(isSupportedRosterFile("names.txt")).toBe(true);
    expect(isSupportedRosterFile("roster.xlsx")).toBe(false);
    expect(isSupportedRosterFile("roster.pdf")).toBe(false);
  });
});
