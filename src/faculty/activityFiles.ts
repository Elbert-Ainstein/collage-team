// What an activity is allowed to carry, decided without touching the network.
//
// Split out from facultyData so the rules can be tested for what they are —
// arithmetic and string handling — and so the faculty picker, the drop target
// and the write path all refuse the same file for the same stated reason. A
// second copy of "is this a PDF" is how a file gets past one gate and stopped
// by the other, after the upload has already happened.

import type { FileRef } from "@/checkins/types";

/** How many attachments one activity may hold. */
export const MAX_ATTACHMENTS = 6;

/** The largest single attachment, in bytes. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * For `<input accept=...>`.
 *
 * Extensions AND types, because the two pickers disagree about which they
 * honour: macOS filters on the UTI behind the MIME type, Windows on the
 * extension, and a list carrying only one of them greys out real files on the
 * other platform. This is a convenience filter either way — refuseFile is the
 * gate, since a drop target has no accept attribute at all.
 */
export const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

export type AttachmentKind = "pdf" | "image" | "other";

/**
 * Extension -> the types a browser may honestly report for it.
 *
 * `image/jpg` is not a registered type and is reported anyway, by enough tools
 * that refusing it would refuse real photographs.
 *
 * A Map rather than an object literal, because the key comes off a filename
 * somebody chose: a file called "notes.constructor" looked up in an object
 * finds Object.prototype's constructor, which is truthy, is not a list, and
 * throws on .includes — an accepted extension by accident and a crash instead
 * of a refusal.
 */
const ALLOWED = new Map<string, readonly string[]>([
  ["pdf", ["application/pdf"]],
  ["png", ["image/png"]],
  ["jpg", ["image/jpeg", "image/jpg"]],
  ["jpeg", ["image/jpeg", "image/jpg"]],
]);

/** The bit after the last dot, lowercased. Empty when there isn't one. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  // A leading dot is a whole filename, not an extension: ".pdf" is a file
  // called .pdf, and treating it as a PDF lets a name with no stem through.
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * What to render this ref as.
 *
 * The type the browser reported first, then the name, because a ref written
 * before 0012 has a name and nothing else — and a ref whose type arrived empty
 * from a drag still has to render as the picture it is. Lenient on purpose:
 * anything reaching here already got past refuseFile, so this is choosing a
 * viewer, not deciding trust.
 */
export function kindOf(ref: FileRef): AttachmentKind {
  const mime = (ref.mime ?? "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";

  const ext = extensionOf(ref.name ?? "");
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  return "other";
}

/** Bytes -> "1.4 MB", for the ref on the row and for the sentence that refuses one. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  // Nothing this app stores reaches a gigabyte — the cap is 20 MB. This tier
  // exists for the refusal, so someone dropping a 3 GB video reads "3.0 GB"
  // rather than "3072.0 MB" and can see at a glance how far over they are.
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * May this file be attached? null if it may; otherwise the sentence to show.
 *
 * Both the extension and the reported type have to be right, and neither alone
 * is enough. A file dragged out of some applications arrives with type "", so
 * an empty type with a .pdf name is a PDF; a .exe announcing itself as
 * application/pdf is not, whatever it says. The two must also agree with each
 * other — a name and a type describing different formats is not a file anyone
 * meant to attach.
 *
 * `alreadyHeld` is what the activity holds now. The write path re-checks it
 * against a fresh read; this is the same rule stated early enough that a
 * refusal costs nobody an upload.
 */
export function refuseFile(file: File, alreadyHeld: number): string | null {
  if (alreadyHeld >= MAX_ATTACHMENTS) {
    return `This activity holds ${MAX_ATTACHMENTS} attachments already. Remove one to add another.`;
  }

  const kinds = "Attachments must be PDF, PNG or JPG.";
  const ext = extensionOf(file.name);
  if (!ext) return `"${file.name}" has no file extension. ${kinds}`;

  const types = ALLOWED.get(ext);
  if (!types) return `"${file.name}" is a .${ext} file. ${kinds}`;

  const mime = file.type.toLowerCase();
  if (mime && !types.includes(mime)) {
    return `"${file.name}" is named .${ext} but arrived as ${file.type}. ${kinds}`;
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    // The cap is written whole — humanBytes would render it "20.0 MB", which is
    // a measurement, and this is a rule.
    const cap = MAX_ATTACHMENT_BYTES / (1024 * 1024);
    return `"${file.name}" is ${humanBytes(file.size)}. Attachments are limited to ${cap} MB.`;
  }

  return null;
}
