// The description box, as a document rather than as its source code.
//
// The brief is stored as plain text with `[label](target)` in it, and that is
// the right thing to STORE: one column, no markup, greppable, and the renderer
// that shows it to students is forty lines. It is the wrong thing to make
// somebody LOOK AT while they write. A link to a file is a ninety-character
// token with a UUID in the middle of it, and a sentence with two of those in it
// is unreadable — you cannot proof-read a paragraph you cannot see.
//
// So the box is contentEditable and holds real anchors, and these two functions
// are the border between that and the column. Everything either side stays as
// it was: what gets saved is still `[label](target)`, and BriefText still
// renders exactly what it rendered before.
//
// WHY A DOM WALK AND NOT innerHTML. Building the box means turning stored text
// into nodes, and the stored text is written by a person. Going through an HTML
// string would mean escaping it correctly every time, forever, in a file nobody
// looks at twice. createTextNode cannot produce markup no matter what is in the
// string, so the question never arises — the same reason BriefText builds React
// nodes instead of setting innerHTML.

import { MD_LINK } from "@/checkins/briefLinks";

/** Marks an anchor as one of ours, and carries what to write back for it. */
const TARGET = "target";

/**
 * Parked after a freshly written link so the caret has somewhere to land that
 * is not inside it — otherwise the next word typed joins the link. It exists
 * for the editor only and is stripped on the way out, so it never reaches the
 * stored column. Exported so the editor and the stripper cannot disagree.
 */
export const CARET_SPACE = "\u200B";

/** Set on a file link so CSS can mark it as something that downloads. */
const KIND = "kind";

/**
 * An anchor for the editing surface.
 *
 * The href is deliberately absent. Inside the box these are things to edit, not
 * things to follow — a live href invites a click that navigates away from a
 * half-written description, and for a file the URL expires anyway. What has to
 * survive is the TARGET, which rides on a data attribute and is what gets
 * written back out.
 */
export function briefAnchor(doc: Document, label: string, target: string): HTMLAnchorElement {
  const a = doc.createElement("a");
  a.className = "fv-brieflink";
  a.dataset[TARGET] = target;
  if (target.toLowerCase().startsWith("file:")) a.dataset[KIND] = "file";
  a.textContent = label;
  return a;
}

/**
 * Stored text -> the nodes to put in the box.
 *
 * `[label](target)` becomes an anchor showing only the label; everything else
 * is text, newlines included — the box is `white-space: pre-wrap`, so a line
 * break is a line break without needing a <br> of its own.
 */
export function briefToFragment(doc: Document, text: string): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const re = new RegExp(MD_LINK, "g");
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) frag.appendChild(doc.createTextNode(text.slice(at, m.index)));
    frag.appendChild(briefAnchor(doc, m[1], m[2]));
    at = m.index + m[0].length;
  }
  if (at < text.length) frag.appendChild(doc.createTextNode(text.slice(at)));
  return frag;
}

/** Elements a browser uses to mean "new line" when Enter is pressed. */
const BLOCK = new Set(["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);

/**
 * The box -> the text to store.
 *
 * The awkward part is that browsers do not agree on what Enter produces:
 * Chrome wraps each line in a <div>, Firefox has historically used <br>, and a
 * box that has been typed in, pasted into and undone holds both at once. Rather
 * than forcing one of them at input time — which fights the browser on every
 * keystroke and loses on some of them — this reads both.
 *
 * It builds LINES rather than concatenating breaks, because the two shapes that
 * matter cannot be told apart any other way. `<div><br></div>` is an empty line
 * and its <br> must count for nothing (the block already made the line), while
 * `<div>two<br></div>` is one line with a padding <br> the browser parks there
 * to keep the end reachable. Both have a <br> with no next sibling; only "which
 * line am I on" separates them.
 */
export function briefFromNode(root: Node): string {
  const lines: string[] = [""];
  /** Nothing has been written yet, so the first block is not a NEW line. */
  const untouched = () => lines.length === 1 && lines[0] === "";
  const newLine = () => lines.push("");
  /** Text may carry its own newlines — stored text nodes hold them literally. */
  const write = (s: string) => {
    const parts = s.split("\n");
    lines[lines.length - 1] += parts[0];
    for (let i = 1; i < parts.length; i += 1) lines.push(parts[i]);
  };

  const isBlock = (n: ChildNode): boolean =>
    n.nodeType === 1 && BLOCK.has((n as HTMLElement).tagName);

  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        write(child.nodeValue ?? "");
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as HTMLElement;

      if (el.tagName === "BR") {
        // Nothing after it: padding the browser parks at the end of a block so
        // the last line stays reachable. Counted, it would add a blank line to
        // the description on every save.
        //
        // A block after it: the break is redundant, because the block is about
        // to start a line of its own. Counting both is how one Enter becomes
        // two lines in a box that has been pasted into.
        if (el.nextSibling && !isBlock(el.nextSibling)) newLine();
        continue;
      }

      const target = el.dataset?.[TARGET];
      if (el.tagName === "A" && target) {
        // The label is whatever is in the anchor NOW — the words are editable,
        // and typing inside a link has to change what gets written back.
        //
        // A link with nothing legible in it is dropped, and the caret spaces
        // come off BEFORE that is decided. Left in, an anchor holding only a
        // spacer counts as having a label, gets written as `[<spacer>](url)`,
        // and is then stripped to `[](url)` on the way out — which the link
        // pattern does not match, so the class reads the brackets themselves.
        const label = el.textContent?.split(CARET_SPACE).join("") ?? "";
        if (label.trim()) write(`[${label}](${target})`);
        continue;
      }

      if (BLOCK.has(el.tagName)) {
        if (!untouched()) newLine();
        walk(el);
        continue;
      }

      // A <span> from a paste, a stray <b>, an anchor from another page — keep
      // the words, drop the markup.
      walk(el);
    }
  };

  walk(root);
  // A trailing empty line is the browser keeping the end reachable, not
  // something anybody typed. The caret spaces are this file's own scaffolding
  // and must never reach the column — left in, every link written would add an
  // invisible character to the description, and they accumulate.
  return lines
    .join("\n")
    .split(CARET_SPACE)
    .join("")
    .replace(/\n$/, "");
}
