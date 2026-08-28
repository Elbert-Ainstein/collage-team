import { describe, expect, it } from "vitest";
import { safeHref } from "./BriefText";

// A brief is written by faculty and rendered to eighty students. Everything
// here is about the same question: can a string in that box become something
// that runs when a student taps it?

describe("safeHref", () => {
  it("passes an ordinary https link through", () => {
    expect(safeHref("https://example.edu/reading.pdf")).toBe("https://example.edu/reading.pdf");
  });

  it("passes http, because a school intranet is often not on https", () => {
    expect(safeHref("http://intranet.school/handout")).toBe("http://intranet.school/handout");
  });

  it("promotes a bare www. to https rather than leaving it dead", () => {
    expect(safeHref("www.example.edu")).toBe("https://www.example.edu/");
  });

  // The whole point. Each of these is a live script if it reaches an href.
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.edu/abc",
  ])("refuses %s", (bad) => {
    expect(safeHref(bad)).toBeNull();
  });

  it("refuses a scheme-relative URL rather than guessing at one", () => {
    expect(safeHref("//example.edu/x")).toBeNull();
  });

  it("refuses something that is not a URL at all", () => {
    expect(safeHref("see the handout")).toBeNull();
  });

  // A credential in a brief would be visible to the whole class anyway, but the
  // parser must not silently strip it and produce a DIFFERENT working link.
  it("keeps a url it accepts byte-identical apart from URL normalisation", () => {
    expect(safeHref("https://example.edu/a?b=1&c=2#d")).toBe("https://example.edu/a?b=1&c=2#d");
  });
});

// The editor's Cmd-K validates with the SAME safeHref the renderer uses, so
// these are the exact cases it refuses to author. If that ever diverges, faculty
// could write a link that comes out as dead text in front of the class.
describe("what the editor will let you author", () => {
  it("accepts what a person actually pastes", () => {
    for (const ok of [
      "https://canvas.harvard.edu/courses/1108579",
      "http://intranet.school/handout.pdf",
      "www.example.edu/reading",
    ]) {
      expect(safeHref(ok)).not.toBeNull();
    }
  });

  it("refuses what would render as dead text", () => {
    for (const bad of ["javascript:alert(1)", "mailto:kelly@harvard.edu", "notaurl", ""]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});
