// Roster file parsing (client-side, no dependencies).
//
// Class lists arrive in whatever shape the registrar, the LMS or a colleague's
// spreadsheet produced. The goal here is that a human looking at the file can
// see names and addresses, the parser finds the same ones, and anything it is
// unsure about is reported rather than guessed at silently.
//
// Handles: CSV / TSV / semicolon-delimited / pipe-delimited / plain lists,
// quoted fields with embedded delimiters and doubled quotes, a header row that
// is not the first line, LMS exports with many extra columns, "Last, First"
// and "Last, First Middle", name suffixes, "Name <email>", separate first/last
// columns, CRLF, Excel's BOM, non-breaking spaces and smart quotes.
//
// Excel workbooks are not parsed — .xlsx is zipped XML and needs a library; the
// UI tells the user to export as CSV instead.

export interface ParsedStudent {
  name: string;
  email?: string;
}

export interface ParseResult {
  students: ParsedStudent[];
  /** Non-fatal notes to show the user (skipped rows, detected columns, …). */
  warnings: string[];
}

const EMAIL_RE = /[^\s,;<>()[\]"]+@[^\s,;<>()[\]"]+\.[A-Za-z]{2,}/;
const EMAIL_EXACT = new RegExp(`^${EMAIL_RE.source}$`);

/** Suffixes that must not be mistaken for a given name when flipping "Last, First". */
const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v|phd|ph\.d|md|m\.d|esq|do|dds|jd|mba)\.?$/i;

/** Rows an export adds that are not people. */
const JUNK_ROW_RE =
  /^(showing|displaying|total|totals|count|page \d|generated|exported|end of report|\d+ (students?|records?|rows?)\b)/i;

const HEADER_HINT_RE =
  /^(name|full ?name|student|student ?name|students|display ?name|preferred ?name|first|first ?name|given ?name|last|last ?name|family ?name|surname|e-?mail|e-?mail ?address|login|username|user|id|sis ?.*|section|course|role|status)$/i;

/** Split one delimited line, honouring "quoted, fields" and escaped "" quotes. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(clean);
}

function clean(s: string): string {
  return s
    .replace(/ /g, " ") // non-breaking space
    .replace(/[‘’]/g, "'") // smart quotes
    .replace(/[“”]/g, '"')
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
}

/**
 * Pick the delimiter by consistency, not raw frequency: the right one splits
 * most lines into the same number of fields. A name like "Lovelace, Ada" would
 * otherwise make a comma look convincing in a file that is really one column.
 */
function detectDelimiter(lines: string[]): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.slice(0, 25).map((l) => splitLine(l, d).length);
    const max = Math.max(...counts, 1);
    if (max < 2) continue;
    const agree = counts.filter((c) => c === max).length / counts.length;
    const score = agree * 10 + max * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore < 0 ? "," : best;
}

const looksLikeHeader = (cells: string[]) => {
  const named = cells.filter(Boolean);
  if (named.length < 1) return false;
  const hits = named.filter((c) => HEADER_HINT_RE.test(c)).length;
  // A header row is mostly recognisable labels and contains no email address.
  return hits >= Math.max(1, Math.ceil(named.length * 0.5)) && !named.some((c) => EMAIL_RE.test(c));
};

function findColumns(header: string[]) {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  return {
    name: find(/^(name|full ?name|student ?name|student|students|display ?name|preferred ?name)$/i),
    first: find(/^(first|first ?name|given ?name)$/i),
    last: find(/^(last|last ?name|family ?name|surname)$/i),
    email: find(/^(e-?mail|e-?mail ?address|primary e-?mail|school e-?mail|login ?id|sis ?login ?id)$/i),
  };
}

/** "Doe, Jane" → "Jane Doe"; "Doe, Jane Marie" → "Jane Marie Doe". Leaves the rest alone. */
function normalizeName(raw: string): string {
  let s = clean(raw).replace(/\s+/g, " ");
  if (!s) return "";

  // "Ada Lovelace <ada@x.edu>" → "Ada Lovelace"
  s = s.replace(/<[^>]*>/g, "").trim();
  if (EMAIL_EXACT.test(s)) return "";

  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (m) {
    const left = m[1].trim();
    const right = m[2].trim();
    // "King, Jr." is one name with a suffix, not "Jr. King".
    if (right && left && !SUFFIX_RE.test(right)) return `${right} ${left}`;
  }
  return s;
}

/** Cells that are clearly identifiers rather than a person's name. */
function isNameLike(s: string): boolean {
  if (!s) return false;
  if (EMAIL_RE.test(s)) return false;
  if (/^[\d\s.+\-()]+$/.test(s)) return false; // ids, phone numbers
  if (/^[0-9a-f-]{16,}$/i.test(s)) return false; // uuids
  if (!/[A-Za-zÀ-ɏ]/.test(s)) return false; // must contain a letter
  return true;
}

function emailIn(cells: string[]): string {
  for (const c of cells) {
    const m = EMAIL_RE.exec(c);
    if (m) return m[0];
  }
  return "";
}

export function parseRoster(text: string): ParseResult {
  const warnings: string[] = [];
  const students: ParsedStudent[] = [];

  const lines = text
    .replace(/^﻿/, "") // Excel's byte-order mark
    .split(/\r\n|\r|\n/)
    // Normalise before splitting: a smart-quoted "Last, First" would otherwise
    // split on its own comma, because the quotes are not the ASCII ones.
    .map((l) =>
      l
        .replace(/\u00a0/g, " ")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'"),
    )
    .filter((l) => l.trim().length > 0 && !/^[\s,;|\t]+$/.test(l));

  if (!lines.length) return { students, warnings: ["The file was empty."] };

  let delim = detectDelimiter(lines);
  let rows = lines.map((l) => splitLine(l, delim));

  // "Lovelace, Ada" per line splits into two consistent columns and looks just
  // like a 2-column CSV. Real two-column data carries a header, an address or an
  // id; a bare list of inverted names carries none of those, so treat it as one
  // column and let normalizeName do the flip.
  if (delim === "," && rows.every((r) => r.length === 2)) {
    const flat = lines.join(" ");
    const looksLikeNamesOnly =
      !EMAIL_RE.test(flat) && !/\d/.test(flat) && !looksLikeHeader(rows[0]);
    if (looksLikeNamesOnly) {
      delim = "\u0000"; // a delimiter no roster contains
      rows = lines.map((l) => [clean(l)]);
    }
  }

  // The header is usually the first line, but exports often put a title or a
  // blank-ish preamble above it. Look a little way down.
  let cols = { name: -1, first: -1, last: -1, email: -1 };
  let start = 0;
  const detected: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (looksLikeHeader(rows[i])) {
      const found = findColumns(rows[i]);
      if (found.name >= 0 || (found.first >= 0 && found.last >= 0) || found.email >= 0) {
        cols = found;
        start = i + 1;
        if (found.name >= 0) detected.push("name");
        if (found.first >= 0 && found.last >= 0) detected.push("first + last");
        if (i > 0) warnings.push(`Ignored ${i} line${i === 1 ? "" : "s"} above the header.`);
      }
      break;
    }
  }

  let skipped = 0;
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    const joined = cells.join(" ").trim();
    if (JUNK_ROW_RE.test(joined)) {
      skipped++;
      continue;
    }

    let name = "";
    if (cols.name >= 0 && cells[cols.name]) {
      name = cells[cols.name];
    } else if (cols.first >= 0 || cols.last >= 0) {
      name = [cells[cols.first] ?? "", cells[cols.last] ?? ""].filter(Boolean).join(" ");
    }
    if (!name) {
      // No usable header: the name is the first cell that reads like one.
      name = cells.find((c) => isNameLike(c)) ?? "";
      // A single "Ada Lovelace <ada@x.edu>" cell still yields both.
      if (!name && cells.length === 1) name = cells[0];
    }

    let email = "";
    if (cols.email >= 0 && cells[cols.email]) {
      const m = EMAIL_RE.exec(cells[cols.email]);
      if (m) email = m[0];
    }
    if (!email) email = emailIn(cells);

    name = normalizeName(name);
    if (!name) {
      skipped++;
      continue;
    }
    students.push(email ? { name, email: email.toLowerCase() } : { name });
  }

  if (skipped) warnings.push(`Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no name.`);

  // De-duplicate within the file: by name, and by address where present.
  const seenName = new Set<string>();
  const seenEmail = new Set<string>();
  const unique = students.filter((s) => {
    const n = s.name.toLowerCase();
    const e = s.email?.toLowerCase();
    if (seenName.has(n) || (e && seenEmail.has(e))) return false;
    seenName.add(n);
    if (e) seenEmail.add(e);
    return true;
  });
  const dupes = students.length - unique.length;
  if (dupes) warnings.push(`Removed ${dupes} duplicate${dupes === 1 ? "" : "s"} from the file.`);

  const withEmail = unique.filter((s) => s.email).length;
  // Only claim an email column once it actually produced an address — an LMS
  // "SIS Login ID" matches the header but holds usernames.
  if (withEmail > 0) detected.push("email");
  if (detected.length) {
    warnings.unshift(`Detected column${detected.length > 1 ? "s" : ""}: ${detected.join(", ")}.`);
  }
  if (unique.length && withEmail === 0) {
    warnings.push("No email addresses found — students cannot sign in without one.");
  } else if (withEmail < unique.length) {
    warnings.push(`${unique.length - withEmail} of ${unique.length} have no email address.`);
  }

  return { students: unique, warnings };
}

/** True for files we can actually read as text. */
export function isSupportedRosterFile(name: string): boolean {
  return /\.(csv|tsv|txt|tab|text)$/i.test(name.trim());
}
