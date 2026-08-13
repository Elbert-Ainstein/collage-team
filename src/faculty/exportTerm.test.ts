import { describe, expect, it } from "vitest";
import { manifestCsv, safeFilename, toCsv, type ManifestRow } from "./exportTerm";

describe("toCsv", () => {
  it("leaves ordinary fields alone", () => {
    expect(toCsv([["a", "b"]])).toBe("a,b\r\n");
  });

  // The whole reason this function exists. A roster carries "Han, Caleb" and a
  // marker's note carries quotes and newlines; unescaped, every column to the
  // right shifts by one and the file still opens, which is worse than failing.
  it("quotes a field containing a comma", () => {
    expect(toCsv([["Han, Caleb"]])).toBe('"Han, Caleb"\r\n');
  });

  it("doubles an embedded quote", () => {
    expect(toCsv([['she said "no"']])).toBe('"she said ""no"""\r\n');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsv([["one\ntwo"]])).toBe('"one\ntwo"\r\n');
  });

  it("writes null and undefined as empty rather than as words", () => {
    expect(toCsv([[null, undefined, 0]])).toBe(",,0\r\n");
  });

  it("keeps a zero, which is a real score", () => {
    expect(toCsv([[0]])).toBe("0\r\n");
  });
});

describe("safeFilename", () => {
  it("joins the parts it was given", () => {
    expect(safeFilename("AP50A", "Fall 2026", "grades")).toBe("ap50a-fall-2026-grades");
  });

  it("drops empty parts rather than leaving a gap", () => {
    expect(safeFilename("AP50A", null, "grades")).toBe("ap50a-grades");
  });

  it("collapses anything a filesystem would argue about", () => {
    expect(safeFilename("AP 50 / B: week 8")).toBe("ap-50-b-week-8");
  });
});

describe("manifestCsv", () => {
  const row: ManifestRow = {
    kind: "photo",
    week: 8,
    activity: "CHALLENGE - Velocity",
    subject: "Team 3",
    path: "course/activity/team/whiteboard.jpg",
    detail: "whiteboard, end of session",
    bytes: 4_194_304,
    createdAt: "2026-10-14T15:04:00.000Z",
  };

  it("puts the path last, where it stays findable in a bucket dump", () => {
    const [header, body] = manifestCsv([row]).trim().split("\r\n");
    expect(header.split(",").at(-1)).toBe("Path");
    expect(body.split(",").at(-1)).toBe("course/activity/team/whiteboard.jpg");
  });

  it("reports a missing size as empty, never as zero", () => {
    const line = manifestCsv([{ ...row, bytes: null }]).trim().split("\r\n")[1];
    // Recordings and hand-ins have no size_bytes column, so a 0 here would be a
    // number somebody adds up and believes.
    expect(line).toContain(",,");
    expect(line).not.toContain(",0,");
  });

  it("survives an activity title with a comma in it", () => {
    const csv = manifestCsv([{ ...row, activity: "Combo, part two" }]);
    expect(csv).toContain('"Combo, part two"');
    expect(csv.trim().split("\r\n")[1].split(",").at(-1)).toBe(row.path);
  });
});
