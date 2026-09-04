import { describe, expect, it } from "vitest";
import { briefFiles, fileToken, filePath, linkAt, withDownload } from "./briefLinks";

// The regex BriefText matches `[words](url)` with. A token that does not
// survive it is a token that truncates its own link in front of the class, so
// the round-trip tests below check against the real pattern rather than a
// hand-wave about "no parentheses".
const MD = /\[([^\]\n]+)\]\(([^()\s]+)\)/;

describe("fileToken / filePath", () => {
  it("round-trips an ordinary bucket path", () => {
    const p = "b7c1e0a2-1111-4222-8333-abcdef123456/week-3-case.pdf";
    expect(filePath(fileToken(p))).toBe(p);
  });

  // Every one of these is a filename somebody has actually saved.
  it.each([
    "act-1/notes (final).pdf",
    "act-1/Reading — Ostrom 1990.pdf",
    "act-1/data set #2.pdf",
    "act-1/a b c.png",
    "act-1/100% of the grade.pdf",
    "act-1/q&a.pdf",
    "act-1/naïve café.pdf",
    "act-1/報告.pdf",
  ])("round-trips %s", (p) => {
    expect(filePath(fileToken(p))).toBe(p);
  });

  // The one that matters most: parentheses are what encodeURIComponent leaves
  // behind, and they are exactly what the markdown arm stops at.
  it("survives the link pattern whole, parentheses and all", () => {
    const p = "act-1/notes (final draft).pdf";
    const m = MD.exec(`[the notes](${fileToken(p)})`);
    expect(m).not.toBeNull();
    expect(filePath(m![2])).toBe(p);
  });

  it("never emits whitespace or brackets, whatever the filename", () => {
    const t = fileToken("act-1/a b (c) [d].pdf");
    expect(t).not.toMatch(/[\s()[\]]/);
  });

  it("is case-insensitive about the scheme, because people retype it", () => {
    expect(filePath("FILE:act-1%2Fx.pdf")).toBe("act-1/x.pdf");
  });
});

describe("filePath refuses what is not a file reference", () => {
  it.each([
    "https://example.edu/reading.pdf",
    "www.example.edu",
    "notaurl",
    "",
    "file:",
    // A "%" typed as a character, not as an escape. Someone writing about a
    // grade breakdown will do this, and it must not throw on the way past.
    "file:100%",
    "file:%E0%A4%A",
    // A raw slash is never in a token this module wrote. These must be refused
    // HERE so BriefText falls through and shows them as the characters they
    // are, rather than resolving them to nothing and hiding a dead link from
    // the only person who can fix it.
    "file:///etc/passwd",
    "file://host/share",
    "file:act-1/x.pdf",
  ])("refuses %s", (bad) => {
    expect(filePath(bad)).toBeNull();
  });
});

describe("withDownload", () => {
  it("appends to a signed URL, which always already has a query", () => {
    expect(withDownload("https://s.co/object/sign/a/b.pdf?token=xyz", "b.pdf")).toBe(
      "https://s.co/object/sign/a/b.pdf?token=xyz&download=b.pdf",
    );
  });

  it("starts the query when there is not one, rather than writing a broken &", () => {
    expect(withDownload("https://s.co/x.pdf", "x.pdf")).toBe(
      "https://s.co/x.pdf?download=x.pdf",
    );
  });

  it("encodes a filename with spaces, so the parameter survives", () => {
    expect(withDownload("https://s.co/x?token=1", "week 3 (final).pdf")).toBe(
      "https://s.co/x?token=1&download=week%203%20(final).pdf",
    );
  });

  it("keeps the token it was given untouched", () => {
    const signed = "https://s.co/object/sign/a/b.pdf?token=eyJhbGciOi.J9&x=1";
    expect(withDownload(signed, "b.pdf").startsWith(signed)).toBe(true);
  });
});

describe("linkAt", () => {
  const text = "Read [the case](https://a.co/b) before [the notes](file:x%2Fy.pdf) tonight.";
  const CASE = { start: 5, end: 31 };

  it("finds the link the caret is sitting inside", () => {
    const got = linkAt(text, 10, 10);
    expect(got).toMatchObject({ label: "the case", target: "https://a.co/b", ...CASE });
  });

  it("finds it from the very edges of the span", () => {
    expect(linkAt(text, CASE.start, CASE.start)?.label).toBe("the case");
    expect(linkAt(text, CASE.end, CASE.end)?.label).toBe("the case");
  });

  it("returns the whole span, brackets included, so the caller can replace it", () => {
    const got = linkAt(text, 10, 10)!;
    expect(text.slice(got.start, got.end)).toBe("[the case](https://a.co/b)");
  });

  it("picks the second link when the caret is in the second one", () => {
    const got = linkAt(text, 45, 45);
    expect(got?.label).toBe("the notes");
    expect(filePath(got!.target)).toBe("x/y.pdf");
  });

  it("is null in ordinary prose", () => {
    expect(linkAt(text, 2, 2)).toBeNull();
    expect(linkAt(text, 70, 70)).toBeNull();
  });

  // Half a link and half a sentence is a selection made to replace both.
  it("is null for a selection that only overlaps a link", () => {
    expect(linkAt(text, 0, 12)).toBeNull();
    expect(linkAt(text, 20, 40)).toBeNull();
  });

  it("is null in text with no links at all", () => {
    expect(linkAt("just some prose", 4, 4)).toBeNull();
  });
});

describe("briefFiles", () => {
  const urls = new Map([["a/one.pdf", "https://s.co/one?token=t"]]);

  it("pairs a ref with the URL signed for its path", () => {
    const got = briefFiles([{ name: "one.pdf", path: "a/one.pdf" }], urls);
    expect(got.get("a/one.pdf")).toEqual({ href: "https://s.co/one?token=t", name: "one.pdf" });
  });

  it("omits a ref the backend would not sign, rather than half-building it", () => {
    expect(briefFiles([{ name: "two.pdf", path: "a/two.pdf" }], urls).size).toBe(0);
  });

  // A row written before 0012 recorded a NAME and nothing else.
  it("omits a ref that has no path", () => {
    expect(briefFiles([{ name: "old.pdf" }], urls).size).toBe(0);
  });

  it("is empty for no refs", () => {
    expect(briefFiles([], urls).size).toBe(0);
  });
});
