"use client";

// The description box: a document to write in, not source code to look at.
//
// The brief is stored as plain text with `[label](target)` links in it
// (BriefText renders it, richBrief translates it), and this is the box every
// kind of activity writes it in — the check-in page's editor first, and the
// live-questions builder since it got the same box rather than a textarea
// that showed students' links as raw brackets. A chain and a paperclip, ⌘K,
// a bar on whichever link the caret is in: nothing to learn, and one place
// to fix it.
//
// UNCONTROLLED on purpose. Re-rendering a contentEditable's children from
// state on every keystroke puts the caret back at the start on every
// keystroke; the box is filled once, when it mounts, and read back out
// through onChange as it changes. A caller that wants it refilled remounts it
// (a key on the activity does that).

import { useEffect, useRef, useState } from "react";
import { safeHref } from "@/checkins/BriefText";
import { fileToken, filePath } from "@/checkins/briefLinks";
import type { FileRef } from "@/checkins/types";
import { FIcon } from "./icons";
import { briefAnchor, briefFromNode, briefToFragment, CARET_SPACE } from "./richBrief";

/**
 * How wide the link dialog is drawn, in px — kept here as well as in the CSS
 * because the popover has to be held inside the description rather than run off
 * the side of it, and the arithmetic that does that needs the number.
 */
const LINK_POP_WIDTH = 320;

export function DescriptionEditor({
  initial,
  files,
  onChange,
  placeholder,
}: {
  /** The stored text to start from. Read once, when the box mounts. */
  initial: string;
  /** The activity's attachments, which words can be linked to. Empty where it has none. */
  files: FileRef[];
  /** The text to store, as it changes. */
  onChange: (text: string) => void;
  placeholder: string;
}) {
  const [empty, setEmpty] = useState(!initial.trim());
  const descRef = useRef<HTMLDivElement | null>(null);

  /**
   * The Cmd-K dialog, and where in the description it will write.
   *
   * The box is contentEditable, so "where" is a live Range rather than a pair
   * of offsets. It is captured when the dialog OPENS, not when it closes:
   * focusing the URL field takes the caret out of the box, and by the time
   * anyone presses Insert the browser has forgotten what was highlighted.
   */
  const [linking, setLinking] = useState<
    {
      text: string;
      url: string;
      /** Whether an existing link is being rewritten, not a gap filled. */
      replacing: boolean;
      /** Where to draw it, in the description wrapper's own coordinates. */
      top: number;
      left: number;
    } | null
  >(null);
  const [linkBad, setLinkBad] = useState(false);
  /** Where a new link goes. */
  const linkRange = useRef<Range | null>(null);
  /** The link the caret is in, or the one being edited. */
  const linkNode = useRef<HTMLAnchorElement | null>(null);
  /** Positioned parent for the two popovers, so they can sit by the words. */
  const descWrap = useRef<HTMLDivElement | null>(null);
  /**
   * The bar that appears when the caret lands in a link.
   *
   * This is what replaces having to KNOW that ⌘K works a second time: put the
   * caret in a link and its address and its two buttons are simply there.
   */
  const [chip, setChip] = useState<{ top: number; left: number; label: string; file: boolean } | null>(
    null,
  );

  /** The filename behind a `file:` token, for a link that was given no words. */
  const fileNameFor = (target: string): string | null => {
    const path = filePath(target);
    if (!path) return null;
    return files.find((r) => r.path === path)?.name ?? path.slice(path.lastIndexOf("/") + 1);
  };

  /**
   * Take out links that have lost their words.
   *
   * Delete the text of a link and the anchor stays behind, empty and invisible
   * — and the bar still appears when the caret lands in it, offering to change
   * a link that is not there. Worse, it is a link the box is only pretending to
   * have: briefFromNode already refuses to write one with nothing legible in
   * it, so it would vanish on save with no warning. Removing it as it empties
   * makes the box agree with what can actually be stored.
   *
   * The caret keeps its place, because this fires mid-sentence while somebody
   * is deleting, and a caret that jumps to the top of the box on the last
   * backspace is worse than the link it was cleaning up.
   */
  const dropEmptyLinks = () => {
    const el = descRef.current;
    if (!el) return;
    const sel = window.getSelection();
    const caretIn =
      sel && sel.rangeCount ? anchorAround(sel.getRangeAt(0).commonAncestorContainer, el) : null;
    const dead = Array.from(el.querySelectorAll<HTMLAnchorElement>("a[data-target]")).filter(
      (a) => !(a.textContent ?? "").split(CARET_SPACE).join("").trim(),
    );
    for (const anchor of dead) {
      const holder = document.createTextNode(CARET_SPACE);
      anchor.parentNode?.replaceChild(holder, anchor);
      if (anchor !== caretIn) continue;
      const range = document.createRange();
      range.setStart(holder, CARET_SPACE.length);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  /** Read the box back into the value that gets saved. */
  const syncDesc = () => {
    const el = descRef.current;
    if (!el) return;
    const text = briefFromNode(el);
    setEmpty(!text);
    onChange(text);
  };

  /** The link the caret is inside, or null. */
  const anchorAround = (node: Node | null, root: HTMLElement): HTMLAnchorElement | null => {
    for (let n = node; n && n !== root; n = n.parentNode) {
      if (n.nodeType === 1) {
        const el = n as HTMLElement;
        if (el.tagName === "A" && el.dataset.target) return el as HTMLAnchorElement;
      }
    }
    return null;
  };

  /**
   * Where a range actually is on screen.
   *
   * A COLLAPSED range — a caret with nothing selected — measures as a rect of
   * all zeros in Chrome. Subtracting the wrapper's own offset from zero then
   * gives a large negative number, and the card is drawn hundreds of pixels
   * above the description, off the top of the page. That is the cut-off card.
   *
   * Widening the range by one character to the left puts it on the same line in
   * the same place and gives it something to measure, without touching the DOM
   * — inserting and removing a marker node would invalidate the very range that
   * is about to be saved.
   */
  const measure = (range: Range, box: HTMLElement): DOMRect => {
    const direct = range.getBoundingClientRect();
    if (direct.width || direct.height) return direct;
    if (range.startContainer.nodeType === 3 && range.startOffset > 0) {
      const probe = range.cloneRange();
      probe.setStart(range.startContainer, range.startOffset - 1);
      const widened = probe.getBoundingClientRect();
      if (widened.width || widened.height) return widened;
    }
    // An empty box, or a caret somewhere with nothing to measure either side.
    return box.getBoundingClientRect();
  };

  /** Where a popover goes, in the wrapper's coordinates rather than the page's. */
  const posFor = (rect: DOMRect): { top: number; left: number } => {
    const wrap = descWrap.current;
    if (!wrap) return { top: 0, left: 0 };
    const base = wrap.getBoundingClientRect();
    // Held inside the wrapper, so a link at the right-hand end of a line does
    // not open a card that runs off the side of the page.
    const room = Math.max(0, wrap.clientWidth - LINK_POP_WIDTH);
    return {
      // Never above the wrapper. Whatever went wrong with the measurement, a
      // card the instructor can see and dismiss beats one they cannot reach.
      top: Math.max(0, rect.bottom - base.top + 8),
      left: Math.max(0, Math.min(rect.left - base.left, room)),
    };
  };

  /** A link's address as something a person reads: a filename, or a host. */
  const readableTarget = (target: string): string => {
    const name = fileNameFor(target);
    if (name) return name;
    const href = safeHref(target);
    if (!href) return target;
    const url = new URL(href);
    const tail = url.pathname === "/" ? "" : url.pathname;
    return `${url.host}${tail}`;
  };

  /** Open the dialog on the link the caret is in. */
  const editLink = () => {
    const anchor = linkNode.current;
    if (!anchor) return;
    setLinkBad(false);
    setChip(null);
    linkRange.current = null;
    setLinking({
      text: anchor.textContent ?? "",
      url: anchor.dataset.target ?? "",
      replacing: true,
      ...posFor(anchor.getBoundingClientRect()),
    });
  };

  /**
   * Show or hide the bar for whatever the caret is in now.
   *
   * Called from the box's own click and key handlers rather than from a
   * document-wide selectionchange listener: this only has to be right while
   * somebody is in the box, and a global listener would fire on every selection
   * anywhere on the page for the whole time the editor is open.
   */
  const refreshChip = () => {
    const el = descRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return setChip(null);
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return setChip(null);
    const anchor = anchorAround(range.commonAncestorContainer, el);
    if (!anchor) {
      linkNode.current = null;
      return setChip(null);
    }
    linkNode.current = anchor;
    const target = anchor.dataset.target ?? "";
    setChip({
      ...posFor(anchor.getBoundingClientRect()),
      label: readableTarget(target),
      file: Boolean(filePath(target)),
    });
  };

  const openLink = () => {
    const el = descRef.current;
    if (!el) return;
    let sel = window.getSelection();
    // Pressed from the toolbar with the caret somewhere else on the page. Put
    // it at the end of the description rather than doing nothing: a button that
    // sometimes ignores you is worse than one that always writes somewhere.
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      el.focus();
      const end = document.createRange();
      end.selectNodeContents(el);
      end.collapse(false);
      sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(end);
    }
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    setLinkBad(false);

    // Cmd-K with the caret inside a link EDITS that link, which is what every
    // editor does and what people press it expecting. Without this the second
    // Cmd-K nests a link inside the words of the first and breaks both.
    const found = anchorAround(range.commonAncestorContainer, el);
    if (found) {
      linkNode.current = found;
      editLink();
      return;
    }
    linkNode.current = null;
    linkRange.current = range.cloneRange();
    setChip(null);
    setLinking({
      text: range.toString(),
      url: "",
      replacing: false,
      ...posFor(measure(range, el)),
    });
  };

  /**
   * The same dialog, reached from the paperclip.
   *
   * With one attachment there is no choice to make, so it is made: the button
   * says "File" and one press links the file. With several, the dialog's own
   * list is the choice.
   */
  const openFileLink = () => {
    openLink();
    const only = files.length === 1 ? files[0] : null;
    if (!only?.path) return;
    const path = only.path;
    setLinking((cur) =>
      cur ? { ...cur, url: fileToken(path), text: cur.text.trim() ? cur.text : only.name } : cur,
    );
  };

  /**
   * Put the caret after a link that was just written, and read the box back.
   *
   * The zero-width space is doing real work: with the caret merely placed after
   * the anchor, a browser will happily carry on typing INSIDE it and the next
   * word joins the link. A text node of its own to land in is the reliable way
   * out, and briefFromNode strips the character so it never reaches the column.
   */
  const caretAfter = (anchor: HTMLAnchorElement) => {
    const el = descRef.current;
    if (!el) return;
    let after = anchor.nextSibling;
    // Offset 0 of the text that already follows — the far end of it is the end
    // of the sentence, which is not where anybody was writing.
    let offset = 0;
    if (!after || after.nodeType !== 3) {
      after = document.createTextNode(CARET_SPACE);
      anchor.parentNode?.insertBefore(after, anchor.nextSibling);
      // Past the spacer rather than in front of it, so the caret is clear of
      // the link's boundary and the next word does not join it.
      offset = CARET_SPACE.length;
    }
    const range = document.createRange();
    range.setStart(after, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.focus();
    syncDesc();
  };

  const insertLink = () => {
    if (!linking) return;
    const target = linking.url.trim();
    // Checked with the SAME functions the renderer uses, so the editor cannot
    // author a link that would come out as dead text in front of the class:
    // either a web address it will open, or a file this activity carries.
    if (!safeHref(target) && !filePath(target)) {
      setLinkBad(true);
      return;
    }
    // A link with no words falls back to the filename for an attachment and to
    // the address for the web — in both cases the most readable thing to hand.
    const label = linking.text.trim() || fileNameFor(target) || target;

    const existing = linkNode.current;
    if (existing) {
      existing.textContent = label;
      existing.dataset.target = target;
      if (filePath(target)) existing.dataset.kind = "file";
      else delete existing.dataset.kind;
      setLinking(null);
      caretAfter(existing);
      return;
    }
    const range = linkRange.current;
    if (!range) return;
    const anchor = briefAnchor(document, label, target);
    range.deleteContents();
    range.insertNode(anchor);
    setLinking(null);
    caretAfter(anchor);
  };

  /**
   * Enter, done by hand.
   *
   * Left to the browser, a break taken at the end of a link is taken INSIDE it:
   * the anchor is carried onto the new line and everything typed there comes
   * out blue and linked to the same place. Stepping the caret past the anchor
   * first is what stops that.
   *
   * The break itself still goes through execCommand, which is what keeps ⌘Z
   * working — and it does not matter whether the browser writes a newline, a
   * <br> or a <div>, because briefFromNode reads all three as one line break.
   */
  const newLine = () => {
    const el = descRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // Only for a caret. A selection spanning a link is being REPLACED by the
    // break, so where it starts is not where the new line belongs.
    if (range.collapsed) {
      const anchor = anchorAround(range.commonAncestorContainer, el);
      if (anchor) {
        const out = document.createRange();
        out.setStartAfter(anchor);
        out.collapse(true);
        sel.removeAllRanges();
        sel.addRange(out);
      }
    }
    document.execCommand("insertText", false, "\n");
    syncDesc();
    setChip(null);
  };

  /** Unwrap a link back to its words, leaving the sentence intact. */
  const removeLink = () => {
    const anchor = linkNode.current;
    const el = descRef.current;
    if (!anchor || !el) return;
    anchor.parentNode?.replaceChild(document.createTextNode(anchor.textContent ?? ""), anchor);
    setLinking(null);
    setChip(null);
    syncDesc();
    el.focus();
  };

  /** Point the dialog at one of the activity's attachments. */
  const pickFile = (ref: FileRef) => {
    if (!linking || !ref.path) return;
    setLinkBad(false);
    setLinking({
      ...linking,
      url: fileToken(ref.path),
      // Only when nothing was selected and nothing typed: a phrase the
      // instructor chose always outranks a filename.
      text: linking.text.trim() ? linking.text : ref.name,
    });
  };


  // Fill the box once — turning the stored `[label](target)` into the anchors
  // somebody can actually read. The DOM is the live copy from then on.
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.replaceChildren(briefToFragment(document, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    /* The description and everything that acts on it, in one positioned
       box so the two popovers can sit beside the words they are about
       rather than at the bottom of the page. */
    <div className="fv-descwrap" ref={descWrap}>
      {/* The toolbar carries the whole explanation. A chain and a
          paperclip are the two marks everyone already reads as "link"
          and "file", the shortcut is printed on the button that owns it
          rather than in a sentence underneath, and the paperclip says
          for itself that it is unavailable until something is attached.
          The paragraph of instructions this replaces was the tell that
          none of it was findable. */}
      <div className="fv-descbar">
        <button
          type="button"
          className="fv-descbtn"
          onClick={openLink}
          // The selection has to survive the press, and a button takes
          // focus on mousedown — which collapses it before the click.
          onMouseDown={(e) => e.preventDefault()}
          title="Turn the selected words into a link"
        >
          <FIcon name="link" size={15} />
          Link
          <kbd className="fv-kbd">⌘K</kbd>
        </button>
        <button
          type="button"
          className="fv-descbtn"
          onClick={openFileLink}
          onMouseDown={(e) => e.preventDefault()}
          disabled={!files.length}
          title={
            files.length
              ? "Link the selected words to a file — students click the words and it downloads"
              : "Attach a file below first, then you can link words to it"
          }
        >
          <FIcon name="attachFile" size={15} />
          File
        </button>
      </div>

      <div
        ref={descRef}
        className="fv-descin"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Description"
        data-placeholder={placeholder}
        // UNCONTROLLED on purpose. Re-rendering the box's children from
        // state on every keystroke puts the caret back at the start on
        // every keystroke; the effect above fills it once when the
        // editor opens, and the DOM is the live copy until it is read
        // back.
        data-empty={empty ? "true" : undefined}
        onInput={() => {
          // Order matters: clear out the empties first, so what is read
          // back and what the bar is drawn from are the same box.
          dropEmptyLinks();
          syncDesc();
          refreshChip();
        }}
        onBlur={syncDesc}
        onClick={refreshChip}
        onKeyUp={refreshChip}
        onKeyDown={(e) => {
          // The shortcut every editor uses for this, so nobody has to
          // be told it exists. Meta on a Mac, Ctrl elsewhere.
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            openLink();
            return;
          }
          // Shift-Enter too: in a box with no paragraphs, both mean
          // "next line", and only one of them working is a papercut.
          if (e.key === "Enter") {
            e.preventDefault();
            newLine();
          }
        }}
        onPaste={(e) => {
          // Paste the WORDS, never the markup. A paste out of a web
          // page otherwise arrives with its spans, its styling and its
          // own anchors, and a brief slowly turns into somebody's
          // stylesheet. execCommand is the deprecated call every
          // browser still implements and the only one that keeps the
          // native undo stack — losing ⌘Z in a writing box is worse
          // than the deprecation.
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
      />

      {/* Put the caret in a link and this says where it goes and offers
          the only two things anyone wants to do to it. Nothing to know
          and nothing to read first. */}
      {chip && !linking ? (
        <div className="fv-linkchip" style={{ top: chip.top, left: chip.left }}>
          <FIcon name={chip.file ? "attachFile" : "link"} size={13} />
          <span className="fv-linkchipname" title={chip.label}>
            {chip.label}
          </span>
          <button
            type="button"
            className="fv-chipbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editLink}
          >
            Change
          </button>
          <button
            type="button"
            className="fv-chipbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={removeLink}
          >
            <FIcon name="linkOff" size={13} />
            Remove
          </button>
        </div>
      ) : null}

      {linking ? (
        <div className="fv-linkpop" style={{ top: linking.top, left: linking.left }}>
          <div className="fv-linkrow">
            <span className="fv-linkkey">Text</span>
            <input
              className="fv-in"
              placeholder="Words students will see"
              value={linking.text}
              onChange={(e) => setLinking({ ...linking, text: e.target.value })}
              // Enter and Escape work from EITHER field. Having them on
              // only one is how a dialog feels half-finished: you tab
              // back to fix the words, press Enter, and nothing happens.
              onKeyDown={(e) => {
                if (e.key === "Enter") insertLink();
                if (e.key === "Escape") setLinking(null);
              }}
            />
          </div>
          <div className="fv-linkrow">
            <span className="fv-linkkey">Link</span>
            <input
              className="fv-in"
              placeholder="Paste a web address"
              autoFocus
              // A file's token is machine-written and unreadable, so the
              // field shows the filename instead. What is stored
              // underneath is unchanged.
              value={fileNameFor(linking.url) ?? linking.url}
              readOnly={Boolean(filePath(linking.url))}
              onChange={(e) => {
                setLinkBad(false);
                setLinking({ ...linking, url: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") insertLink();
                if (e.key === "Escape") setLinking(null);
                // Backspace on a chosen file clears it rather than
                // doing nothing, so there is a way back out.
                if (e.key === "Backspace" && filePath(linking.url)) {
                  e.preventDefault();
                  setLinking({ ...linking, url: "" });
                }
              }}
            />
          </div>

          {files.length ? (
            <div className="fv-linkfiles">
              {files.map((ref, i) => {
                const chosen = Boolean(ref.path) && linking.url === fileToken(ref.path ?? "");
                return (
                  <button
                    key={ref.path ?? `${i}:${ref.name}`}
                    type="button"
                    className={`fv-filechip${chosen ? " on" : ""}`}
                    // A ref written before 0012 has a name and no bytes
                    // anywhere, so there is nothing for a link to reach.
                    disabled={!ref.path}
                    title={ref.path ? ref.name : "No file was stored for this one."}
                    onClick={() => pickFile(ref)}
                  >
                    <FIcon name="attachFile" size={12} />
                    {ref.name}
                  </button>
                );
              })}
            </div>
          ) : null}

          {linkBad ? (
            <div className="fv-linkbad">
              That is not a web address this will open — links have to start with http or
              https. To point at a file, pick one above.
            </div>
          ) : null}

          <div className="fv-linkactions">
            <button type="button" className="fv-btn primary sm" onClick={insertLink}>
              {linking.replacing ? "Save" : "Add link"}
            </button>
            <button
              type="button"
              className="fv-btn ghost sm"
              onClick={() => setLinking(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
