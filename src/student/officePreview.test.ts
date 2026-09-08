// Reading a .pptx, .docx and .xlsx in the browser.
//
// The files here are built by the test, part by part, in the shape Office
// actually writes — a zip of XML — so what is pinned is the parsing and not a
// fixture nobody can read. What matters most: the text comes out in the order
// it appears, a slide's pictures come with it, and nothing in any of these
// files can become markup, because none of this produces HTML.

import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { readDocx, readPptx, readXlsx } from "./officePreview";

// jsdom has no createObjectURL; the readers mint one per picture.
beforeAll(() => {
  const made: string[] = [];
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:${made.length}-${blob.type}`;
    made.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
});

const bytes = (zip: JSZip) => zip.generateAsync({ type: "arraybuffer" });

function slideXml(lines: string[], withPicture = false): string {
  const runs = lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("");
  const pic = withPicture ? '<p:pic><a:blip r:embed="rId2"/></p:pic>' : "";
  return `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${runs}${pic}</p:spTree></p:cSld></p:sld>`;
}

describe("a PowerPoint deck", () => {
  it("reads every slide, in order, with its words", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml(["Photocatalytic water splitting", "Team 4"]));
    zip.file("ppt/slides/slide2.xml", slideXml(["Method", "TiO2 electrode"]));
    // Deliberately double digits: a plain sort puts slide10 before slide2.
    zip.file("ppt/slides/slide10.xml", slideXml(["Conclusions"]));

    const doc = await readPptx(await bytes(zip));
    expect(doc.slides?.map((s) => s.lines[0])).toEqual([
      "Photocatalytic water splitting",
      "Method",
      "Conclusions",
    ]);
    expect(doc.slides?.[0].lines).toEqual(["Photocatalytic water splitting", "Team 4"]);
  });

  it("brings the pictures on a slide with it", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml(["Results"], true));
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0"?><Relationships><Relationship Id="rId2" Target="../media/image1.png"/></Relationships>`,
    );
    zip.file("ppt/media/image1.png", new Uint8Array([137, 80, 78, 71]));

    const doc = await readPptx(await bytes(zip));
    expect(doc.slides?.[0].images).toHaveLength(1);
    expect(doc.slides?.[0].images[0]).toContain("image/png");
  });

  it("skips a picture format a browser cannot draw", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml(["Chart"], true));
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0"?><Relationships><Relationship Id="rId2" Target="../media/image1.emf"/></Relationships>`,
    );
    zip.file("ppt/media/image1.emf", new Uint8Array([1, 2, 3]));

    // An <img> pointed at a Windows metafile shows nothing at all.
    const doc = await readPptx(await bytes(zip));
    expect(doc.slides?.[0].images).toEqual([]);
    expect(doc.slides?.[0].lines).toEqual(["Chart"]);
  });
});

describe("a Word document", () => {
  it("keeps headings, paragraphs, bullets and tables apart", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Method</w:t></w:r></w:p>
        <w:p><w:r><w:t>We measured </w:t></w:r><w:r><w:t>the current.</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>450nm source</w:t></w:r></w:p>
        <w:p><w:r><w:t> </w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>t</w:t></w:r></w:p></w:tc>
                    <w:tc><w:p><w:r><w:t>I</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`,
    );

    const doc = await readDocx(await bytes(zip));
    expect(doc.blocks).toEqual([
      { kind: "heading", text: "Method" },
      // Runs joined: Word splits a sentence across them wherever it likes.
      { kind: "paragraph", text: "We measured the current." },
      { kind: "bullet", text: "450nm source" },
      { kind: "table", rows: [["t", "I"]] },
    ]);
  });
});

describe("an Excel sheet", () => {
  it("resolves shared strings and keeps empty cells in place", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0"?><workbook><sheets><sheet name="Run 1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0"?><sst><si><t>wavelength</t></si><si><t>intensity</t></si></sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0"?><worksheet><sheetData>
         <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
         <row r="2"><c r="A2"><v>480</v></c><c r="C2"><v>0.42</v></c></row>
       </sheetData></worksheet>`,
    );

    const doc = await readXlsx(await bytes(zip));
    expect(doc.sheets?.[0].name).toBe("Run 1");
    expect(doc.sheets?.[0].rows).toEqual([
      ["wavelength", "intensity"],
      // B2 is missing from the file, so the value in C2 must not slide left.
      ["480", "", "0.42"],
    ]);
  });
});

describe("a zip from a stranger", () => {
  it("refuses one with an implausible number of parts", async () => {
    const zip = new JSZip();
    for (let i = 0; i < 2100; i++) zip.file(`ppt/slides/slide${i}.xml`, "<x/>");
    await expect(readPptx(await bytes(zip))).rejects.toThrow(/more parts than a document/);
  });
});
