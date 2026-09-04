// The border between the editing box and the stored column.
//
// The property that matters is the ROUND TRIP: text that goes into the box has
// to come back out unchanged, or every save quietly rewrites the instructor's
// description. The browser-shaped cases below are the ones that actually broke
// things by hand — Chrome's <div> per line, the padding <br>, a pasted <span>.

import { describe, expect, it } from "vitest";
import { briefAnchor, briefFromNode, briefToFragment, CARET_SPACE } from "./richBrief";

/** Put text through the box and read it back, the way a save does. */
function roundTrip(text: string): string {
  const host = document.createElement("div");
  host.appendChild(briefToFragment(document, text));
  return briefFromNode(host);
}

/** Build a box from HTML, to stand in for what a browser leaves behind. */
function fromHtml(html: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  return briefFromNode(host);
}

describe("round trip", () => {
  it.each([
    "",
    "Just some prose.",
    "Read [the case](https://example.edu/c.pdf) first.",
    "[the case](https://example.edu/c.pdf)",
    "Two [a](https://a.co) links [b](https://b.co) here.",
    "A file: [the notes](file:act-1%2Fnotes.pdf) — click it.",
    "Line one\nline two",
    "Line one\n\nline three",
    "Trailing words after [a link](https://a.co).",
    "Punctuation (parenthetical) and [a link](https://a.co), then more.",
    "Unicode — naïve café 報告 100%",
  ])("survives %j", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("keeps a multi-line description with links on several lines", () => {
    const text = "Bring:\n- [the case](https://a.co/case)\n- [the notes](file:act-1%2Fn.pdf)\nThanks.";
    expect(roundTrip(text)).toBe(text);
  });
});

describe("the anchor carries the target, not an href", () => {
  it("shows only the label", () => {
    const a = briefAnchor(document, "the case", "https://example.edu/c.pdf");
    expect(a.textContent).toBe("the case");
    expect(a.getAttribute("href")).toBeNull();
    expect(a.dataset.target).toBe("https://example.edu/c.pdf");
  });

  it("marks a file link so it can be shown as one", () => {
    expect(briefAnchor(document, "notes", "file:act-1%2Fn.pdf").dataset.kind).toBe("file");
    expect(briefAnchor(document, "web", "https://a.co").dataset.kind).toBeUndefined();
  });

  // The words in a link are editable, so the label written back is whatever is
  // in the anchor at save time, not what it was created with.
  it("writes back an edited label", () => {
    const host = document.createElement("div");
    const a = briefAnchor(document, "the case", "https://a.co");
    host.appendChild(a);
    a.textContent = "the case study";
    expect(briefFromNode(host)).toBe("[the case study](https://a.co)");
  });

  // An anchor holding only a caret spacer has no words in it. Kept, it would be
  // written as `[](url)`, which the link pattern does not match — so the class
  // would read the brackets and the address as characters on the page.
  it("drops a link holding nothing but a caret spacer", () => {
    const host = document.createElement("div");
    const a = briefAnchor(document, "x", "https://a.co");
    host.appendChild(a);
    a.textContent = CARET_SPACE;
    expect(briefFromNode(host)).toBe("");
  });

  it("drops a link whose words are only spaces", () => {
    const host = document.createElement("div");
    const a = briefAnchor(document, "x", "https://a.co");
    host.appendChild(a);
    a.textContent = "   ";
    expect(briefFromNode(host)).toBe("");
  });

  it("drops a link whose words were all deleted", () => {
    const host = document.createElement("div");
    const a = briefAnchor(document, "gone", "https://a.co");
    host.appendChild(a);
    a.textContent = "";
    expect(briefFromNode(host)).toBe("");
  });
});

describe("what browsers actually leave in the box", () => {
  it("reads Chrome's div-per-line as line breaks", () => {
    expect(fromHtml("one<div>two</div><div>three</div>")).toBe("one\ntwo\nthree");
  });

  it("reads Firefox's <br> as a line break", () => {
    expect(fromHtml("one<br>two")).toBe("one\ntwo");
  });

  // <div><br></div> is Chrome's empty line: one break, not two.
  it("counts an empty line once", () => {
    expect(fromHtml("one<div><br></div><div>three</div>")).toBe("one\n\nthree");
  });

  // The <br> a browser parks at the end so the last line stays reachable is
  // padding. Counted, it would add a blank line to the description per save.
  it("ignores the trailing padding break", () => {
    expect(fromHtml("one<br>")).toBe("one");
    expect(fromHtml("one<div>two<br></div>")).toBe("one\ntwo");
  });

  // A <br> sitting right before a block is redundant: the block starts a line
  // of its own. Counting both is how one Enter becomes two lines after a paste.
  it("does not double-count a break that a block already implies", () => {
    expect(fromHtml("one<br><div>two</div>")).toBe("one\ntwo");
  });

  it("does not open with a blank line when the box starts with blocks", () => {
    expect(fromHtml("<div>one</div><div>two</div>")).toBe("one\ntwo");
  });

  it("reads several empty lines in a row", () => {
    expect(fromHtml("one<div><br></div><div><br></div><div>four</div>")).toBe("one\n\n\nfour");
  });

  it("keeps the words from a pasted span and drops the markup", () => {
    expect(fromHtml('plain <span style="color:red">red</span> words')).toBe("plain red words");
  });

  it("keeps the words from pasted bold and italic", () => {
    expect(fromHtml("say <b>this</b> and <i>that</i>")).toBe("say this and that");
  });

  // A pasted anchor from another page has an href and no data-target. It is
  // not one of ours, so its words are kept and its address is not invented.
  it("keeps the words of a foreign anchor without inventing a link", () => {
    expect(fromHtml('see <a href="https://evil.co">this</a> now')).toBe("see this now");
  });

  it("survives an empty box", () => {
    expect(fromHtml("")).toBe("");
    expect(fromHtml("<br>")).toBe("");
  });
});

// The editor parks a zero-width space after each new link so the caret has
// somewhere to land outside it. Left in, every link ever written would add an
// invisible character to the description, and they accumulate across saves.
describe("the caret space never reaches the column", () => {
  it("is stripped from plain text", () => {
    expect(fromHtml(`one${CARET_SPACE}two`)).toBe("onetwo");
  });

  it("is stripped from beside a link, which is where it is actually put", () => {
    const host = document.createElement("div");
    host.appendChild(briefToFragment(document, "Read [the case](https://a.co) now"));
    const anchor = host.querySelector("a")!;
    anchor.parentNode!.insertBefore(document.createTextNode(CARET_SPACE), anchor.nextSibling);
    expect(briefFromNode(host)).toBe("Read [the case](https://a.co) now");
  });

  it("is stripped even when it is all the box holds", () => {
    expect(fromHtml(CARET_SPACE)).toBe("");
  });
});
