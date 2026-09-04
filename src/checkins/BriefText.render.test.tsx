// What a brief actually renders to.
//
// safeHref is pinned in BriefText.test.ts as a function. This file mounts the
// component, because the questions here are about what reaches the DOM: whether
// a refused scheme can still arrive as an href, and whether a file: token can
// reach anything the reader was not already being shown.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BriefText } from "./BriefText";
import { briefFiles, fileToken } from "./briefLinks";

// Matches the other component tests: without it React warns on every act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: JSX.Element): void {
  act(() => root.render(node));
}

const REFS = [
  { name: "week-3-case.pdf", path: "act-1/week-3-case.pdf" },
  { name: "notes (final).pdf", path: "act-1/notes (final).pdf" },
];
const SIGNED = new Map([
  ["act-1/week-3-case.pdf", "https://s.co/object/sign/act-1/case?token=abc"],
  ["act-1/notes (final).pdf", "https://s.co/object/sign/act-1/notes?token=def"],
]);
const FILES = briefFiles(REFS, SIGNED);

const anchors = () => [...host.querySelectorAll("a")];
const only = () => {
  const a = anchors();
  expect(a).toHaveLength(1);
  return a[0];
};

describe("a file the activity carries", () => {
  const brief = `Read [the case](${fileToken("act-1/week-3-case.pdf")}) first.`;

  it("shows the instructor's words, never the token", () => {
    render(<BriefText text={brief} files={FILES} />);
    expect(only().textContent).toBe("the case");
    expect(host.textContent).toBe("Read the case first.");
  });

  it("points at the signed URL it was handed", () => {
    render(<BriefText text={brief} files={FILES} />);
    expect(only().getAttribute("href")).toContain("https://s.co/object/sign/act-1/case?token=abc");
  });

  // The whole ask: clicking it saves the file. Storage is another origin, so
  // the attribute alone would open a PDF in a tab — the query param is what
  // actually does it, and losing it would look like the feature never shipped.
  it("asks the server for a download, not a tab", () => {
    render(<BriefText text={brief} files={FILES} />);
    expect(only().getAttribute("href")).toContain("&download=week-3-case.pdf");
  });

  it("does not open a blank tab, which a download would leave behind", () => {
    render(<BriefText text={brief} files={FILES} />);
    expect(only().getAttribute("target")).toBeNull();
  });

  it("handles a filename with parentheses, which the link pattern stops at", () => {
    render(
      <BriefText text={`See [the notes](${fileToken("act-1/notes (final).pdf")}).`} files={FILES} />,
    );
    expect(only().textContent).toBe("the notes");
    expect(only().getAttribute("href")).toContain("token=def");
    expect(host.textContent).toBe("See the notes.");
  });
});

describe("a file token that resolves to nothing", () => {
  // Another activity's file, a guess, a typo. The map is the only authority,
  // and it only ever holds what this reader is already being shown.
  it("cannot reach a path outside the map it was given", () => {
    render(<BriefText text={`[secret](${fileToken("act-9/exam-answers.pdf")})`} files={FILES} />);
    expect(anchors()).toHaveLength(0);
  });

  // On first paint the URLs have not come back yet. Students must not watch
  // raw markup flash on every page load.
  it("renders the words, not the markup, while the URLs are still being signed", () => {
    render(<BriefText text={`Read [the case](${fileToken("act-1/week-3-case.pdf")}) first.`} />);
    expect(anchors()).toHaveLength(0);
    expect(host.textContent).toBe("Read the case first.");
  });

  it("says nothing different when the file was removed after being linked", () => {
    render(
      <BriefText text={`Read [the case](${fileToken("act-1/gone.pdf")}) first.`} files={FILES} />,
    );
    expect(host.textContent).toBe("Read the case first.");
  });
});

describe("the file arm does not widen what a link may be", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
  ])("refuses %s an href", (bad) => {
    render(<BriefText text={`[tap here](${bad})`} files={FILES} />);
    expect(anchors()).toHaveLength(0);
  });

  // file:/// is three slashes: a real local path, not one of our tokens. It
  // must not resolve, and it must stay visible so its author can see it is dead.
  it("leaves a local file path on screen as the characters typed", () => {
    render(<BriefText text="[tap here](file:///etc/passwd)" files={FILES} />);
    expect(host.textContent).toBe("[tap here](file:///etc/passwd)");
  });
});

describe("web links still work exactly as before", () => {
  it("renders an ordinary link in a new tab, with the opener severed", () => {
    render(<BriefText text="See [the reading](https://example.edu/r.pdf) tonight." files={FILES} />);
    expect(only().getAttribute("href")).toBe("https://example.edu/r.pdf");
    expect(only().getAttribute("target")).toBe("_blank");
    expect(only().getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("still links a bare URL with no files in play at all", () => {
    render(<BriefText text="See https://example.edu/r.pdf tonight." />);
    expect(only().getAttribute("href")).toBe("https://example.edu/r.pdf");
  });

  it("passes plain prose through untouched", () => {
    render(<BriefText text="Bring a laptop and the printed handout." />);
    expect(anchors()).toHaveLength(0);
    expect(host.textContent).toBe("Bring a laptop and the printed handout.");
  });

  it("renders a web link and a file link side by side", () => {
    render(
      <BriefText
        text={`[a](https://example.edu/x) and [b](${fileToken("act-1/week-3-case.pdf")})`}
        files={FILES}
      />,
    );
    expect(anchors().map((a) => a.textContent)).toEqual(["a", "b"]);
    expect(host.textContent).toBe("a and b");
  });
});
