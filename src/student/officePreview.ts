// Reading an Office file in the browser, without sending it anywhere.
//
// A .pptx, .docx or .xlsx is a zip of XML. Everything here unzips one, walks
// the XML with the browser's own parser, and hands back plain data — strings,
// rows, and object URLs for the pictures a deck has in it. The viewer renders
// that as React elements.
//
// WHY NOT A LIBRARY THAT PRODUCES HTML. The obvious shortcut is a converter
// that turns a document into an HTML string, which is then injected. That
// makes every uploaded file a potential script: the drive holds whatever a
// team put in it, and "trusted because a classmate uploaded it" is not a
// security model. Plain data through React's own escaping cannot carry markup
// at all, and what is lost — a document's exact styling — is the thing this
// was never going to reproduce faithfully anyway.
//
// WHAT THIS IS NOT: a renderer. A deck's layout, fonts, animations and speaker
// notes are not reproduced, and the viewer says so, because a marker who
// mistakes this for the real file would be marking something they have not
// seen.

import type JSZipT from "jszip";

/** A zip from a stranger. Both caps are about not being asked to allocate a
 *  gigabyte because somebody uploaded a 4 KB file that says it is one. */
const MAX_ENTRIES = 2_000;
const MAX_UNZIPPED = 80 * 1024 * 1024;

export interface Slide {
  /** Every run of text on the slide, in document order. */
  lines: string[];
  /** Object URLs for the pictures placed on it. The caller revokes them. */
  images: string[];
}

export interface DocBlock {
  kind: "heading" | "paragraph" | "bullet" | "table";
  text?: string;
  rows?: string[][];
}

export interface Sheet {
  name: string;
  rows: string[][];
}

export interface OfficeDoc {
  slides?: Slide[];
  blocks?: DocBlock[];
  sheets?: Sheet[];
  /** Object URLs this document minted, for the caller to revoke on close. */
  revoke: () => void;
}

async function openZip(bytes: ArrayBuffer): Promise<JSZipT> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files);
  if (files.length > MAX_ENTRIES) {
    throw new Error("That file has more parts than a document should — it was not opened.");
  }
  let claimed = 0;
  for (const f of files) {
    // _data carries the uncompressed size before anything is decompressed.
    claimed += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (claimed > MAX_UNZIPPED) {
      throw new Error("That file unpacks to more than this page can hold — download it instead.");
    }
  }
  return zip;
}

/** Text out of an Office XML part, in document order. */
function textOf(xml: string, tag: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName(tag))
    .map((n) => n.textContent ?? "")
    .filter((t) => t.trim().length > 0);
}

/** "ppt/slides/slide10.xml" sorts after slide9, which a plain sort does not. */
const byNumber = (a: string, b: string) => {
  const n = (s: string) => Number(/(\d+)\.xml$/.exec(s)?.[1] ?? 0);
  return n(a) - n(b);
};

const MIME_OF: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

export async function readPptx(bytes: ArrayBuffer): Promise<OfficeDoc> {
  const zip = await openZip(bytes);
  const made: string[] = [];

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(byNumber);

  const slides: Slide[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    // a:t is a text run — the same element in every Office format.
    const lines = textOf(xml, "a:t");

    // Which pictures this slide places, via its relationships part.
    const relName = name.replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
    const images: string[] = [];
    const rels = zip.files[relName];
    if (rels) {
      const relXml = await rels.async("string");
      const doc = new DOMParser().parseFromString(relXml, "application/xml");
      for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
        const target = rel.getAttribute("Target") ?? "";
        if (!/^\.\.\/media\//.test(target)) continue;
        const path = `ppt/media/${target.split("/").pop()}`;
        const ext = (path.split(".").pop() ?? "").toLowerCase();
        const mime = MIME_OF[ext];
        // Only the formats a browser can draw: a deck's embedded .emf is a
        // Windows metafile, and an <img> pointed at one shows nothing.
        if (!mime || !zip.files[path]) continue;
        const blob = await zip.files[path].async("blob");
        const url = URL.createObjectURL(new Blob([blob], { type: mime }));
        made.push(url);
        images.push(url);
      }
    }
    slides.push({ lines, images });
  }

  return { slides, revoke: () => made.forEach((u) => URL.revokeObjectURL(u)) };
}

export async function readDocx(bytes: ArrayBuffer): Promise<OfficeDoc> {
  const zip = await openZip(bytes);
  const part = zip.files["word/document.xml"];
  if (!part) throw new Error("That does not look like a Word document inside.");
  const doc = new DOMParser().parseFromString(await part.async("string"), "application/xml");

  const blocks: DocBlock[] = [];
  const body = doc.getElementsByTagName("w:body")[0];
  if (!body) return { blocks, revoke: () => undefined };

  const runText = (node: Element): string =>
    Array.from(node.getElementsByTagName("w:t"))
      .map((t) => t.textContent ?? "")
      .join("")
      .trim();

  for (const node of Array.from(body.children)) {
    if (node.tagName === "w:p") {
      const text = runText(node);
      if (!text) continue;
      const style = node.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") ?? "";
      const bulleted = node.getElementsByTagName("w:numPr").length > 0;
      blocks.push({
        kind: /^Heading|^Title/i.test(style) ? "heading" : bulleted ? "bullet" : "paragraph",
        text,
      });
    } else if (node.tagName === "w:tbl") {
      const rows = Array.from(node.getElementsByTagName("w:tr")).map((tr) =>
        Array.from(tr.getElementsByTagName("w:tc")).map((tc) => runText(tc)),
      );
      if (rows.length) blocks.push({ kind: "table", rows });
    }
  }
  return { blocks, revoke: () => undefined };
}

/** "C7" → column 2 (zero-based), so a row with gaps lands in the right places. */
function columnOf(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(bytes: ArrayBuffer): Promise<OfficeDoc> {
  const zip = await openZip(bytes);

  // Most cells are a number pointing into this one shared table of strings.
  const sharedPart = zip.files["xl/sharedStrings.xml"];
  const shared = sharedPart
    ? Array.from(
        new DOMParser()
          .parseFromString(await sharedPart.async("string"), "application/xml")
          .getElementsByTagName("si"),
      ).map((si) =>
        Array.from(si.getElementsByTagName("t"))
          .map((t) => t.textContent ?? "")
          .join(""),
      )
    : [];

  // Sheet names live in the workbook; the parts are numbered separately.
  const workbook = zip.files["xl/workbook.xml"];
  const names = workbook
    ? Array.from(
        new DOMParser()
          .parseFromString(await workbook.async("string"), "application/xml")
          .getElementsByTagName("sheet"),
      ).map((s) => s.getAttribute("name") ?? "Sheet")
    : [];

  const sheetNames = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort(byNumber);

  const sheets: Sheet[] = [];
  for (let i = 0; i < sheetNames.length; i++) {
    const xml = await zip.files[sheetNames[i]].async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const rows: string[][] = [];
    for (const row of Array.from(doc.getElementsByTagName("row"))) {
      const cells: string[] = [];
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const at = columnOf(c.getAttribute("r") ?? "A1");
        const type = c.getAttribute("t");
        const raw =
          type === "inlineStr"
            ? (c.getElementsByTagName("t")[0]?.textContent ?? "")
            : (c.getElementsByTagName("v")[0]?.textContent ?? "");
        const value = type === "s" ? (shared[Number(raw)] ?? "") : raw;
        while (cells.length < at) cells.push("");
        cells[at] = value;
      }
      rows.push(cells);
    }
    sheets.push({ name: names[i] ?? `Sheet ${i + 1}`, rows });
  }
  return { sheets, revoke: () => undefined };
}
