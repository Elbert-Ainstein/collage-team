// Roster file parsing (client-side, no dependencies).
//
// Handles the shapes a class list actually arrives in: CSV/TSV/semicolon
// exports from an LMS, or a plain list of names. Excel workbooks are not
// parsed — .xlsx is a zip of XML and needs a library; the UI tells the user to
// export as CSV instead.

import { NON_MIXABLE_ATTRS } from "./constants";
import type { StudentAttrs } from "./types";

export interface ParsedStudent {
  name: string;
  email?: string;
  /** Extra columns, keyed by header — these become mixable attributes. */
  attrs?: StudentAttrs;
}

export interface ParseResult {
  students: ParsedStudent[];
  /** Non-fatal notes to show the user (skipped rows, detected columns, …). */
  warnings: string[];
  /** Extra column headers found, in file order — the mix-by candidates. */
  attrKeys: string[];
}

const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

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
  return out.map((s) => s.trim().replace(/^"(.*)"$/s, "$1").trim());
}

function detectDelimiter(sample: string): string {
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0 };
  let inQuotes = false;
  for (const ch of sample) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

/** "Doe, Jane" → "Jane Doe"; leaves anything else alone. */
function normalizeName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (m && !EMAIL_RE.test(s)) {
    const last = m[1].trim();
    const first = m[2].trim();
    // Guard against suffixes ("King, Jr.") producing a reversed oddity.
    if (first && last && !/^(jr|sr|ii|iii|iv|phd|md)\.?$/i.test(first)) {
      return `${first} ${last}`;
    }
  }
  return s;
}

const looksLikeHeader = (cells: string[]) =>
  cells.some((c) => /^(name|full ?name|student|student ?name|first|last|email|e-?mail)$/i.test(c.trim()));

function findColumns(header: string[]) {
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  return {
    name: idx(/^(name|full ?name|student ?name|student|display ?name)$/i),
    first: idx(/^(first|first ?name|given ?name)$/i),
    last: idx(/^(last|last ?name|family ?name|surname)$/i),
    email: idx(/^(email|e-?mail|email ?address|login ?id)$/i),
  };
}

/**
 * Columns that are not the name/email are kept as attributes, so "major" or
 * "skill tag" can be mixed by. Only named columns qualify — without a header
 * there is nothing to call the attribute.
 */
function findAttrColumns(
  header: string[],
  cols: { name: number; first: number; last: number; email: number },
): { index: number; key: string }[] {
  const used = new Set([cols.name, cols.first, cols.last, cols.email]);
  return header
    .map((h, index) => ({ index, key: h.trim().toLowerCase() }))
    .filter((c) => !used.has(c.index) && c.key.length > 0 && !NON_MIXABLE_ATTRS.has(c.key));
}

export function parseRoster(text: string): ParseResult {
  const warnings: string[] = [];
  const students: ParsedStudent[] = [];

  const lines = text
    .replace(/^﻿/, "") // strip BOM
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim().length > 0);

  if (!lines.length) {
    return { students, warnings: ["The file was empty."], attrKeys: [] };
  }

  const delim = detectDelimiter(lines.slice(0, 10).join("\n"));
  const rows = lines.map((l) => splitLine(l, delim));

  let cols = { name: -1, first: -1, last: -1, email: -1 };
  let attrCols: { index: number; key: string }[] = [];
  let start = 0;
  if (looksLikeHeader(rows[0])) {
    cols = findColumns(rows[0]);
    attrCols = findAttrColumns(rows[0], cols);
    start = 1;
    const named: string[] = [];
    if (cols.name >= 0) named.push("name");
    if (cols.first >= 0 && cols.last >= 0) named.push("first + last");
    if (cols.email >= 0) named.push("email");
    if (named.length) warnings.push(`Detected column${named.length > 1 ? "s" : ""}: ${named.join(", ")}.`);
    if (attrCols.length) {
      warnings.push(
        `Kept as mixable attribute${attrCols.length > 1 ? "s" : ""}: ` +
          `${attrCols.map((c) => c.key).join(", ")}.`,
      );
    }
  }

  let skipped = 0;
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    let name = "";
    let email = "";

    if (cols.name >= 0 && cells[cols.name]) {
      name = cells[cols.name];
    } else if (cols.first >= 0 || cols.last >= 0) {
      name = [cells[cols.first] ?? "", cells[cols.last] ?? ""].join(" ");
    } else {
      // No usable header: take the first cell that is not an email as the name.
      name = cells.find((c) => c && !EMAIL_RE.test(c)) ?? "";
    }

    if (cols.email >= 0 && cells[cols.email] && EMAIL_RE.test(cells[cols.email])) {
      email = cells[cols.email];
    } else {
      email = cells.find((c) => EMAIL_RE.test(c)) ?? "";
    }

    name = normalizeName(name);
    if (!name) {
      skipped++;
      continue;
    }

    const attrs: StudentAttrs = {};
    for (const c of attrCols) {
      const v = (cells[c.index] ?? "").trim();
      if (v) attrs[c.key] = v;
    }

    students.push({
      name,
      ...(email ? { email } : {}),
      ...(Object.keys(attrs).length ? { attrs } : {}),
    });
  }

  if (skipped) warnings.push(`Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no name.`);

  // De-duplicate within the file, keeping the first occurrence.
  const seen = new Set<string>();
  const unique = students.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const dupes = students.length - unique.length;
  if (dupes) warnings.push(`Removed ${dupes} duplicate name${dupes === 1 ? "" : "s"} from the file.`);

  // Only report attributes that actually carried a value for someone.
  const attrKeys = attrCols
    .map((c) => c.key)
    .filter((key) => unique.some((s) => s.attrs?.[key]));

  return { students: unique, warnings, attrKeys };
}

/** True for files we can actually read as text. */
export function isSupportedRosterFile(name: string): boolean {
  return /\.(csv|tsv|txt)$/i.test(name.trim());
}
