// The description box every activity shares: a stored link shows as words
// you can read, what's typed comes back out as the text to store, ⌘K opens
// the link dialog, and a link it writes is `[label](url)` in that text.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileToken } from "@/checkins/briefLinks";
import type { FileRef } from "@/checkins/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DescriptionEditor } = await import("./DescriptionEditor");

let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

const render = (initial: string, files: FileRef[] = []) =>
  act(() => root.render(<DescriptionEditor initial={initial} files={files} onChange={onChange} placeholder="Add a description" />));
const box = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));
const typeInto = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onChange.mockClear();
  // jsdom lays nothing out: a range measures as nothing, which the editor
  // already handles by falling back to the box.
  if (!("getBoundingClientRect" in Range.prototype)) {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    });
  }
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("DescriptionEditor", () => {
  it("shows a stored link as its words, and reads typing back as the text to store", async () => {
    await render("Read [the notes](https://example.org/notes) first");
    const a = box().querySelector<HTMLAnchorElement>("a.fv-brieflink")!;
    expect(a.textContent).toBe("the notes");
    expect(a.dataset.target).toBe("https://example.org/notes");
    expect(a.getAttribute("href")).toBeNull();
    expect(box().dataset.empty).toBeUndefined();

    await act(async () => {
      box().append(" please");
      box().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("Read [the notes](https://example.org/notes) first please");
  });

  it("starts empty with the placeholder, and the paperclip is off without attachments", async () => {
    await render("");
    expect(box().dataset.empty).toBe("true");
    expect(box().dataset.placeholder).toBe("Add a description");
    expect(button("File")?.disabled).toBe(true);
    expect(button("Link")?.disabled).toBe(false);
  });

  it("⌘K opens the link dialog, and Add link writes [label](url) into the text", async () => {
    await render("See ");
    await act(async () => {
      // The caret at the end of the words, as it is after typing them. (jsdom
      // puts no caret anywhere on its own.)
      const end = document.createRange();
      end.selectNodeContents(box());
      end.collapse(false);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(end);
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    });
    const pop = host.querySelector(".fv-linkpop")!;
    expect(pop).not.toBeNull();
    const [text, url] = [...pop.querySelectorAll<HTMLInputElement>("input")];
    await typeInto(text, "the reading");
    await typeInto(url, "https://example.org/reading");
    await act(async () => button("Add link")!.click());
    expect(host.querySelector(".fv-linkpop")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith("See [the reading](https://example.org/reading)");
  });

  it("refuses a link that is not a web address, and says why", async () => {
    await render("");
    await act(async () => button("Link")!.click());
    const url = [...host.querySelectorAll<HTMLInputElement>(".fv-linkpop input")][1];
    await typeInto(url, "javascript:alert(1)");
    await act(async () => button("Add link")!.click());
    expect(host.querySelector(".fv-linkbad")?.textContent).toContain("http");
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("javascript"));
  });

  it("offers the activity's files, and a picked one is stored as a file token", async () => {
    await render("", [{ name: "lab.pdf", path: "act/lab.pdf" }]);
    expect(button("File")?.disabled).toBe(false);
    await act(async () => button("File")!.click());
    // One attachment: picked for you, named after the file.
    const [text] = [...host.querySelectorAll<HTMLInputElement>(".fv-linkpop input")];
    expect(text.value).toBe("lab.pdf");
    await act(async () => button("Add link")!.click());
    expect(onChange).toHaveBeenLastCalledWith(`[lab.pdf](${fileToken("act/lab.pdf")})`);
  });
});
