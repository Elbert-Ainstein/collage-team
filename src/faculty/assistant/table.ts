// The instructor's spreadsheet, read in the browser.
//
// Read whole here; SUMMARISED for the model. The model needs to know there is a
// Gender column holding F, M and NB, and an assessment from 30 to 100 — enough
// to turn "balance gender and the pre-class test" into settings. It does not
// need, and never gets, which student is which: names, addresses and every
// per-student value stay on the page, joined to the roster for the code that
// forms the teams (formTeams.ts).

import type { AttachmentColumn } from "@/assistant/types";
import type { Student } from "@/checkins/types";
import type { Person } from "./formTeams";

export interface Table {
  /** The file name, or "what you pasted". */
  name: string;
  headers: string[];
  rows: string[][];
  /** The file as it came, for handing to the Teams importer unchanged. */
  text: string;
}

/** Split one line, honouring "quoted, fields" and doubled "" quotes. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Whichever separator the header line uses most. */
function delimiterOf(header: string): string {
  const unquoted = header.replace(/"[^"]*"/g, "");
  const counts = [",", "\t", ";", "|"].map((d) => [d, unquoted.split(d).length - 1] as const);
  const [best, seen] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return seen > 0 ? best : ",";
}

export function parseTable(text: string, name: string): Table {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (!lines.length) return { name, headers: [], rows: [], text };
  const delim = delimiterOf(lines[0]);
  const seen = new Map<string, number>();
  const headers = splitLine(lines[0], delim).map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = lines.slice(1).map((l) => {
    const cells = splitLine(l, delim);
    return headers.map((_, i) => cells[i] ?? "");
  });
  return { name, headers, rows, text };
}

const squash = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The most the summary carries, matched to what the server accepts (request.ts):
 * a header or value past these is shortened rather than having the whole
 * request refused, which would make the assistant useless with that file.
 */
export const MAX_SUMMARY_COLUMNS = 200;
const MAX_HEADER = 100;
const MAX_VALUE = 80;
const clampText = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A category has few values that repeat; anything else is a list of people or numbers. */
const MAX_CATEGORY_VALUES = 12;

/** What the model is told about each column. No per-student values, ever. */
export function summarize(table: Table): AttachmentColumn[] {
  return table.headers.slice(0, MAX_SUMMARY_COLUMNS).map((header, ci) => {
    const name = clampText(header, MAX_HEADER);
    const cells = table.rows.map((r) => r[ci]).filter((c) => c !== "");
    const folded = new Map<string, { value: string; count: number }>();
    for (const c of cells) {
      const k = squash(c);
      const at = folded.get(k);
      folded.set(k, at ? { ...at, count: at.count + 1 } : { value: clampText(c.trim(), MAX_VALUE), count: 1 });
    }
    const filled = cells.length;
    const distinct = folded.size;
    const nums = cells.map(Number).filter(Number.isFinite);
    const base = { name, filled, distinct };
    // A number column: mostly numbers (an "n/a" or two is normal), and either
    // many values or all different ones. Small numbers that repeat — a year
    // of 1 to 4, a section — are a category.
    if (filled && nums.length / filled >= 0.75 && (distinct > MAX_CATEGORY_VALUES || distinct === filled)) {
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return { ...base, kind: "number", min: Math.min(...nums), max: Math.max(...nums), mean: Math.round(mean * 10) / 10 };
    }
    if (filled && distinct <= MAX_CATEGORY_VALUES && distinct < filled) {
      const values = [...folded.values()].sort((a, b) => b.count - a.count);
      return { ...base, kind: "category", values };
    }
    const emails = cells.filter((c) => EMAIL.test(c)).length;
    const looksLike = filled && emails / filled >= 0.8 ? "email" : /name|student/i.test(name) ? "name" : undefined;
    return { ...base, kind: "text", ...(looksLike ? { looksLike } : {}) };
  });
}

/**
 * The header the instructor (or the model) meant, whatever its case or spacing
 * — and by its shortened name, which is the only one the model ever saw.
 */
export function findColumn(table: Table, wanted: string): string | null {
  const w = squash(wanted);
  return (
    table.headers.find((h) => squash(h) === w) ??
    table.headers.find((h) => squash(clampText(h, MAX_HEADER)) === w) ??
    null
  );
}

/** The values a column holds, one spelling each, in order — for checking a rule against. */
export function valuesIn(table: Table, column: string): string[] {
  const at = table.headers.indexOf(column);
  const seen = new Map<string, string>();
  for (const row of table.rows) {
    const v = (row[at] ?? "").trim();
    if (v && !seen.has(squash(v))) seen.set(squash(v), v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The value the model meant, by its spelling in the file or the shortened one it saw. */
export function findValue(values: string[], wanted: string): string | null {
  const w = squash(wanted);
  return values.find((v) => squash(v) === w) ?? values.find((v) => squash(clampText(v, MAX_VALUE)) === w) ?? null;
}

/** "Turing, Alan" → "alan turing"; "Ada  Lovelace" → "ada lovelace". */
function personName(raw: string): string {
  const parts = raw.split(",");
  return squash(parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw);
}

export interface Joined {
  /** Everyone on the roster, with their file row's cells (empty when not in the file). */
  people: Person[];
  /** On the roster, not in the file. Placed anyway, without details. */
  missing: Student[];
  /** In the file, on nobody's roster row. Not placed. */
  unmatched: string[];
  /** In the file, but could be two students. Not used. */
  ambiguous: string[];
}

/**
 * Which roster student each file row is about. Address first, name second, a
 * name that could be two people refused rather than guessed — the same rules
 * the Teams importer keeps (teamImport.ts), for the same reasons.
 */
export function joinRoster(table: Table, cols: { email?: string | null; name?: string[] }, roster: Student[]): Joined {
  const ci = (h: string | null | undefined) => (h ? table.headers.indexOf(h) : -1);
  const emailAt = ci(cols.email);
  const nameAt = (cols.name ?? []).map(ci).filter((i) => i >= 0);
  const byEmail = new Map(roster.filter((s) => s.email).map((s) => [squash(s.email as string), s]));
  const byName = new Map<string, Student[]>();
  for (const s of roster) byName.set(personName(s.name), [...(byName.get(personName(s.name)) ?? []), s]);

  const claimed = new Map<string, string[]>();
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const row of table.rows) {
    const label = nameAt.map((i) => row[i]).join(" ").trim() || (emailAt >= 0 ? row[emailAt] : "") || "a row";
    const viaEmail = emailAt >= 0 && row[emailAt] ? byEmail.get(squash(row[emailAt])) : undefined;
    const named = byName.get(personName(nameAt.map((i) => row[i]).join(" "))) ?? [];
    const free = named.filter((s) => !claimed.has(s.id));
    const who = viaEmail ?? (free.length === 1 ? free[0] : undefined);
    if (who && !claimed.has(who.id)) claimed.set(who.id, row);
    else if (!who && free.length > 1) ambiguous.push(label);
    else if (!who) unmatched.push(label);
  }

  const people = roster.map((s) => {
    const row = claimed.get(s.id);
    return { id: s.id, values: row ? Object.fromEntries(table.headers.map((h, i) => [h, row[i]])) : {} };
  });
  return { people, missing: roster.filter((s) => !claimed.has(s.id)), unmatched, ambiguous };
}
