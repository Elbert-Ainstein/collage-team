import { describe, expect, it } from "vitest";
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

describe("isSupportedRosterFile", () => {
  it("accepts text roster formats and rejects workbooks", () => {
    expect(isSupportedRosterFile("roster.csv")).toBe(true);
    expect(isSupportedRosterFile("roster.TSV")).toBe(true);
    expect(isSupportedRosterFile("names.txt")).toBe(true);
    expect(isSupportedRosterFile("roster.xlsx")).toBe(false);
    expect(isSupportedRosterFile("roster.pdf")).toBe(false);
  });
});
