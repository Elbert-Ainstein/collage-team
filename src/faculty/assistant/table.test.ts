// The instructor's spreadsheet, read in the browser.
//
// Only a SUMMARY of it ever leaves the page — column names, how many of each
// category, a number column's range — so the model can turn her rules into
// settings without seeing any one student's gender or score. The rows stay
// here, joined to the roster, for the code that forms the teams.

import { describe, expect, it } from "vitest";
import type { Student } from "@/checkins/types";
import { findColumn, joinRoster, parseTable, summarize } from "./table";

const CSV = [
  "﻿Name,Email,Gender,Pre-class assessment,Track,Year",
  'Ada Lovelace,ADA@x.edu,F,88,Engineering,Freshman',
  '"Turing, Alan",alan@x.edu,M,71,Pre-med,Junior',
  "Grace Hopper,,F,93,Engineering,Freshman",
  "Katherine Johnson,kj@x.edu,F,n/a,Other,Senior",
].join("\r\n");

function student(id: string, name: string, email: string | null): Student {
  return { id, user_id: null, course_id: "c1", name, email, avatar_tint: null, position: 0, created_at: "" };
}

describe("parseTable", () => {
  it("reads a header and rows, quoted commas and all", () => {
    const t = parseTable(CSV, "class.csv");
    expect(t.headers).toEqual(["Name", "Email", "Gender", "Pre-class assessment", "Track", "Year"]);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[1][0]).toBe("Turing, Alan");
  });

  it("reads tab-separated columns copied out of a spreadsheet", () => {
    const t = parseTable("Name\tGender\nAda Lovelace\tF\nAlan Turing\tM", "pasted");
    expect(t.headers).toEqual(["Name", "Gender"]);
    expect(t.rows[1]).toEqual(["Alan Turing", "M"]);
  });

  it("names a blank header and tells two identical headers apart", () => {
    const t = parseTable("Name,,Team,Team\nAda,x,1,2", "f.csv");
    expect(t.headers).toEqual(["Name", "Column 2", "Team", "Team (2)"]);
  });
});

describe("summarize", () => {
  const cols = summarize(parseTable(CSV, "class.csv"));
  const col = (name: string) => cols.find((c) => c.name === name)!;

  it("lists a category's values with their counts, folded", () => {
    expect(col("Gender")).toMatchObject({ kind: "category", values: [{ value: "F", count: 3 }, { value: "M", count: 1 }] });
  });

  it("gives a number column its range and average, not its cells", () => {
    expect(col("Pre-class assessment")).toMatchObject({ kind: "number", min: 71, max: 93, filled: 4 });
    expect(col("Pre-class assessment").values).toBeUndefined();
  });

  it("sends no values at all for names and addresses", () => {
    expect(col("Name")).toMatchObject({ kind: "text", looksLike: "name" });
    expect(col("Email")).toMatchObject({ kind: "text", looksLike: "email" });
    expect(col("Name").values).toBeUndefined();
    expect(JSON.stringify(cols)).not.toContain("Lovelace");
    expect(JSON.stringify(cols)).not.toContain("alan@x.edu");
  });
});

describe("summarize — never more than the server accepts", () => {
  it("shortens a long header, and findColumn still finds the column by the short name", () => {
    const long = "How many hours a week do you expect to spend on problem sets outside of class time".repeat(2);
    const t = parseTable(`Name,${long}\nAda,10\nAlan,12\nGrace,8`, "f.csv");
    const [, col] = summarize(t);
    expect(col.name.length).toBeLessThanOrEqual(100);
    expect(findColumn(t, col.name)).toBe(long);
  });

  it("shortens a long category value", () => {
    const v = "x".repeat(200);
    const t = parseTable(`Name,Note\nAda,${v}\nAlan,${v}\nGrace,short`, "f.csv");
    const note = summarize(t).find((c) => c.name === "Note")!;
    expect(note.values!.every((x) => x.value.length <= 80)).toBe(true);
  });

  it("describes at most 200 columns", () => {
    const headers = Array.from({ length: 250 }, (_, i) => `c${i}`);
    const t = parseTable(`${headers.join(",")}\n${headers.map(() => "1").join(",")}`, "wide.csv");
    expect(summarize(t)).toHaveLength(200);
  });
});

describe("findColumn", () => {
  it("finds a header whatever its case or spacing", () => {
    const t = parseTable(CSV, "class.csv");
    expect(findColumn(t, "pre-class  ASSESSMENT")).toBe("Pre-class assessment");
    expect(findColumn(t, "major")).toBeNull();
  });
});

describe("joinRoster", () => {
  const t = parseTable(CSV, "class.csv");
  const roster = [
    student("s1", "Ada Lovelace", "ada@x.edu"),
    student("s2", "Alan Turing", null),
    student("s3", "Grace Hopper", "grace@x.edu"),
    student("s4", "Dorothy Vaughan", "dv@x.edu"),
  ];

  it("matches by address first, then by name — including Last, First", () => {
    const j = joinRoster(t, { email: "Email", name: ["Name"] }, roster);
    const v = (id: string) => j.people.find((p) => p.id === id)!.values;
    expect(v("s1").Gender).toBe("F");
    expect(v("s2")["Pre-class assessment"]).toBe("71");
    expect(v("s3").Track).toBe("Engineering");
  });

  it("names the rows nobody on the roster matches, and the students the file leaves out", () => {
    const j = joinRoster(t, { email: "Email", name: ["Name"] }, roster);
    expect(j.unmatched).toEqual(["Katherine Johnson"]);
    expect(j.missing.map((s) => s.name)).toEqual(["Dorothy Vaughan"]);
    // A student missing from the file is still placed, just without details.
    expect(j.people.find((p) => p.id === "s4")!.values).toEqual({});
  });

  it("refuses to guess between two students with one name", () => {
    const twins = [student("a", "Ada Lovelace", null), student("b", "Ada Lovelace", null)];
    const j = joinRoster(parseTable("Name,G\nAda Lovelace,F", "f"), { name: ["Name"] }, twins);
    expect(j.ambiguous).toEqual(["Ada Lovelace"]);
    expect(j.people.every((p) => Object.keys(p.values).length === 0)).toBe(true);
  });

  it("joins first and last name columns", () => {
    const j = joinRoster(parseTable("First,Last,G\nAda,Lovelace,F", "f"), { name: ["First", "Last"] }, roster);
    expect(j.people.find((p) => p.id === "s1")!.values.G).toBe("F");
  });
});
