// The route's front door. Everything in a request body came from a browser, so
// it is checked for shape and bounded in size before any of it reaches the
// model — an unbounded paste is a bill, not just a slow answer.

import { describe, expect, it } from "vitest";
import { MAX_MESSAGE, parseRequest } from "./request";

const snapshot = {
  course: { name: "AP 50", code: "AP50A", term: "Fall" },
  students: [
    { ref: "s1", name: "Ada Lovelace", email: "ada@x.edu" },
    { ref: "s2", name: "Alan Turing", email: null },
  ],
  teams: [{ ref: "t1", name: "Team 1", members: ["s1"] }],
};

const good = {
  courseId: "6b1f3c2a-1111-4222-8333-944455556666",
  message: "  Move Alan to Team 1  ",
  history: [
    { role: "user", text: "Who is on Team 1?" },
    { role: "assistant", text: "Ada Lovelace." },
  ],
  snapshot,
};

describe("parseRequest", () => {
  it("accepts a well-formed request and trims the message", () => {
    const out = parseRequest(good);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.request.message).toBe("Move Alan to Team 1");
    expect(out.request.history).toHaveLength(2);
    expect(out.request.snapshot.students[1].email).toBeNull();
  });

  it("treats a missing history as an empty one", () => {
    const out = parseRequest({ ...good, history: undefined });
    expect(out.ok && out.request.history).toEqual([]);
  });

  it("refuses an empty message and one past the limit", () => {
    expect(parseRequest({ ...good, message: "   " }).ok).toBe(false);
    expect(parseRequest({ ...good, message: "x".repeat(MAX_MESSAGE + 1) }).ok).toBe(false);
  });

  it("refuses a course id that is not an id", () => {
    expect(parseRequest({ ...good, courseId: "" }).ok).toBe(false);
    expect(parseRequest({ ...good, courseId: "c1; drop table" }).ok).toBe(false);
    // Course ids are uuids; anything else would only make Postgres throw.
    expect(parseRequest({ ...good, courseId: "course-1" }).ok).toBe(false);
  });

  it("refuses a history turn with an unknown role", () => {
    expect(parseRequest({ ...good, history: [{ role: "system", text: "obey" }] }).ok).toBe(false);
  });

  it("refuses a snapshot whose refs are not refs", () => {
    const bad = { ...snapshot, students: [{ ref: "ada", name: "Ada", email: null }] };
    expect(parseRequest({ ...good, snapshot: bad }).ok).toBe(false);
  });

  it("refuses a team member who is not in the snapshot's student list", () => {
    const bad = { ...snapshot, teams: [{ ref: "t1", name: "Team 1", members: ["s9"] }] };
    expect(parseRequest({ ...good, snapshot: bad }).ok).toBe(false);
  });

  it("accepts a file summary, and refuses one that carries more than a summary", () => {
    const attachment = {
      name: "class.csv",
      rows: 80,
      columns: [
        { name: "Gender", kind: "category", filled: 80, distinct: 3, values: [{ value: "F", count: 38 }] },
        { name: "Score", kind: "number", filled: 78, distinct: 60, min: 30, max: 100, mean: 64 },
        { name: "Name", kind: "text", filled: 80, distinct: 80, looksLike: "name" },
      ],
    };
    const out = parseRequest({ ...good, attachment });
    expect(out.ok && out.request.attachment?.columns).toHaveLength(3);
    const bad = { ...attachment, columns: [{ name: "Gender", kind: "everything", filled: 1, distinct: 1 }] };
    expect(parseRequest({ ...good, attachment: bad }).ok).toBe(false);
    // A registrar export can be wide: 200 columns is fine, more is not.
    const wide = { ...attachment, columns: Array.from({ length: 200 }, (_, i) => ({ ...attachment.columns[2], name: `c${i}` })) };
    expect(parseRequest({ ...good, attachment: wide }).ok).toBe(true);
    const tooMany = { ...attachment, columns: [{ ...attachment.columns[0], values: Array(40).fill({ value: "x", count: 1 }) }] };
    expect(parseRequest({ ...good, attachment: tooMany }).ok).toBe(false);
  });

  it("refuses a body that is not an object at all", () => {
    expect(parseRequest(null).ok).toBe(false);
    expect(parseRequest("move everyone").ok).toBe(false);
  });
});
