import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  humanBytes,
  kindOf,
  refuseFile,
} from "@/faculty/activityFiles";
import type { FileRef } from "@/checkins/types";

// These rules stand between the class and a 3 GB video, and between the bucket
// and an executable named .pdf. Every case here is one somebody actually
// produced: a file dragged out of Preview with no type at all, a phone photo
// announcing image/jpg, a download called "assignment" with no extension.

/**
 * A File of a stated size without allocating it.
 *
 * File derives size from its contents, and the boundary cases here are 20 MB
 * and one byte over — twenty megabytes of zeroes per assertion, to test a
 * comparison.
 */
function pretend(name: string, type: string, size = 1024): File {
  const file = new File([], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("refuseFile", () => {
  it("takes the three formats the course attaches", () => {
    expect(refuseFile(pretend("brief.pdf", "application/pdf"), 0)).toBeNull();
    expect(refuseFile(pretend("board.png", "image/png"), 0)).toBeNull();
    expect(refuseFile(pretend("setup.jpg", "image/jpeg"), 0)).toBeNull();
    expect(refuseFile(pretend("setup.jpeg", "image/jpeg"), 0)).toBeNull();
  });

  // Not registered, reported anyway, by enough cameras and editors that
  // refusing it would refuse real photographs.
  it("takes image/jpg, which is not a real type", () => {
    expect(refuseFile(pretend("lab.jpg", "image/jpg"), 0)).toBeNull();
  });

  it("takes a PDF whose type arrived empty", () => {
    expect(refuseFile(pretend("brief.pdf", ""), 0)).toBeNull();
    expect(refuseFile(pretend("board.png", ""), 0)).toBeNull();
  });

  it("refuses an executable claiming to be a PDF", () => {
    const said = refuseFile(pretend("brief.exe", "application/pdf"), 0);
    expect(said).toBe('"brief.exe" is a .exe file. Attachments must be PDF, PNG or JPG.');
  });

  // The other direction of the same lie: the name is one of ours, the bytes
  // announce something else.
  it("refuses a name and a type that describe different formats", () => {
    const said = refuseFile(pretend("brief.png", "application/pdf"), 0);
    expect(said).toBe(
      '"brief.png" is named .png but arrived as application/pdf. Attachments must be PDF, PNG or JPG.',
    );
  });

  it("refuses a name with no extension at all", () => {
    const said = refuseFile(pretend("assignment", "application/pdf"), 0);
    expect(said).toBe('"assignment" has no file extension. Attachments must be PDF, PNG or JPG.');
  });

  // ".pdf" is a whole filename, not an extension, and reading it as one lets a
  // file with no stem through.
  it("refuses a name that is nothing but an extension", () => {
    expect(refuseFile(pretend(".pdf", "application/pdf"), 0)).toContain("no file extension");
  });

  it("does not care how the extension is cased", () => {
    expect(refuseFile(pretend("BOARD.PNG", "image/png"), 0)).toBeNull();
    expect(refuseFile(pretend("Brief.PDF", ""), 0)).toBeNull();
  });

  it("allows exactly 20 MB and refuses one byte more", () => {
    expect(refuseFile(pretend("big.pdf", "application/pdf", MAX_ATTACHMENT_BYTES), 0)).toBeNull();
    const said = refuseFile(pretend("big.pdf", "application/pdf", MAX_ATTACHMENT_BYTES + 1), 0);
    expect(said).toBe('"big.pdf" is 20.0 MB. Attachments are limited to 20 MB.');
  });

  it("allows the sixth attachment and refuses the seventh", () => {
    const file = pretend("brief.pdf", "application/pdf");
    expect(refuseFile(file, MAX_ATTACHMENTS - 1)).toBeNull();
    expect(refuseFile(file, MAX_ATTACHMENTS)).toBe(
      "This activity holds 6 attachments already. Remove one to add another.",
    );
  });

  // The extension is a key looked up in a table, and it comes off a name
  // somebody chose. Looked up in an object literal this one finds
  // Object.prototype.constructor, which is truthy and has no .includes.
  it("refuses an extension that is also a property of every object", () => {
    expect(refuseFile(pretend("notes.constructor", ""), 0)).toContain("is a .constructor file");
    expect(refuseFile(pretend("notes.toString", ""), 0)).toContain("is a .tostring file");
  });

  it("says which rule was broken and what the file was", () => {
    const said = refuseFile(pretend("recording.mov", "video/quicktime"), 0);
    expect(said).toContain("recording.mov");
    expect(said).toContain(".mov");
  });
});

describe("kindOf", () => {
  it("reads the reported type first", () => {
    expect(kindOf({ name: "brief.pdf", mime: "application/pdf" })).toBe("pdf");
    expect(kindOf({ name: "board.png", mime: "image/png" })).toBe("image");
    expect(kindOf({ name: "setup.jpg", mime: "image/jpeg" })).toBe("image");
  });

  it("falls back to the name when there is no type", () => {
    expect(kindOf({ name: "brief.pdf" })).toBe("pdf");
    expect(kindOf({ name: "board.PNG" })).toBe("image");
    expect(kindOf({ name: "setup.jpeg" })).toBe("image");
  });

  // What a drag out of some applications produces: the bytes are a picture and
  // the browser said nothing useful about them.
  it("falls back to the name when the type is a generic one", () => {
    expect(kindOf({ name: "board.png", mime: "application/octet-stream" })).toBe("image");
  });

  // Pre-0012: a name and nothing else. It can be listed; it cannot be opened,
  // and that is the pane's problem, not this function's.
  it("still names the kind of a ref with no path", () => {
    const legacy: FileRef = { name: "Week 3 handout.pdf" };
    expect(legacy.path).toBeUndefined();
    expect(kindOf(legacy)).toBe("pdf");
  });

  it("is other when nothing says otherwise", () => {
    expect(kindOf({ name: "notes" })).toBe("other");
    expect(kindOf({ name: "notes.txt", mime: "text/plain" })).toBe("other");
  });
});

describe("humanBytes", () => {
  it("scales to the unit that reads", () => {
    expect(humanBytes(400)).toBe("400 B");
    expect(humanBytes(2048)).toBe("2 KB");
    expect(humanBytes(MAX_ATTACHMENT_BYTES)).toBe("20.0 MB");
    expect(humanBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});
