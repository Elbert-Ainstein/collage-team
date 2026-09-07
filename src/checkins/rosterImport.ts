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
// columns, an optional team / group / table number, CRLF, Excel's BOM,
// non-breaking spaces and smart quotes.
//
// Excel workbooks are not parsed — .xlsx is zipped XML and needs a library; the
// UI tells the user to export as CSV instead.

export interface ParsedStudent {
  name: string;
  email?: string;
  /**
   * Which team the file put this student on. `undefined` means the file had no
   * team column at all — the roster import never asks for one. `null` means it
   * had one and this row left it blank, which is a real answer: a student can
   * be on no team, and that is not the same as being on team 0.
   */
  team?: number | null;
}

/** A file's bytes read as text, plus anything the reading itself needs to say. */
export interface DecodedFile {
  text: string;
  warnings: string[];
}

/**
 * A roster file's bytes as text.
 *
 * File.text() is UTF-8 and nothing else: a byte sequence that is not valid
 * UTF-8 becomes U+FFFD, the replacement character, which renders as a black
 * diamond and can never be turned back into the letter it replaced. A class
 * list is exactly the kind of file that is not UTF-8 — Excel writes the
 * machine's legacy code page unless it is told "CSV UTF-8" — and the names it
 * mangles are the accented ones, so the students who lose their own name are
 * the same ones every time.
 *
 * So: UTF-8 when the bytes really are UTF-8, and windows-1252 when they are
 * not, which is what Excel on Windows writes. That produces a wrong letter
 * rather than a diamond, and the warning is what makes it fixable — the name is
 * checkable in the preview before anything is written, and an address-matched
 * row keeps the name it already has, so the moment to fix it is before the
 * import and not after.
 */
export function decodeRosterFile(bytes: ArrayBuffer): DecodedFile {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), warnings: [] };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      warnings: [
        "This file is not saved as UTF-8, so an accented name may come in as the wrong letter. " +
          "Check the names below; if one is wrong, fix it in the spreadsheet and re-save as " +
          "“CSV UTF-8” before importing — a name that is already on the roster is not changed by " +
          "a later import.",
      ],
    };
  }
}

export interface ParseResult {
  students: ParsedStudent[];
  /** Non-fatal notes to show the user (skipped rows, detected columns, …). */
  warnings: string[];
}

// Written as what an address IS, not as what it is not: an exclusion list let
// `|`, `:` and a second `@` through, and produced logins nobody could sign in
// with ("ada|ada@harvard.edu", "alan@@x.edu") out of pipe-delimited files.
const EMAIL_RE = /[A-Za-z0-9!#$%&'*+/=?^_`{}~.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const EMAIL_EXACT = new RegExp(`^${EMAIL_RE.source}$`);

/** Suffixes that must not be mistaken for a given name when flipping "Last, First". */
const SUFFIX_RE = /^(jr|sr|ii|iii|iv|v|phd|ph\.d|md|m\.d|esq|do|dds|jd|mba)\.?$/i;

/** Rows an export adds that are not people. */
const JUNK_ROW_RE =
  /^(showing|displaying|total|totals|count|page \d|generated|exported|end of report|\d+ (students?|records?|rows?)\b)/i;

const HEADER_HINT_RE =
  /^(name|full ?name|student|student ?name|students|display ?name|preferred ?name|first|first ?name|given ?name|last|last ?name|family ?name|surname|e-?mail|e-?mail ?address|login|username|user|id|sis ?(user|login)? ?id|section|course|role|status|(team|group|table|pod|squad)s? ?(#|no\.?|num(ber)?|assignment)?)$/i;

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
    const sample = lines.slice(0, 25).map((l) => splitLine(l, d));
    const counts = sample.map((r) => r.length);
    const max = Math.max(...counts, 1);
    if (max < 2) continue;
    const agree = counts.filter((c) => c === max).length / counts.length;
    // A split that yields a column of clean addresses is the right split. Without
    // this, `,` and `;` tie on "Lovelace, Ada;ada@harvard.edu" and comma wins by
    // being first in the list — taking every given name with it.
    const whole = sample.filter((r) => r.some((c) => EMAIL_EXACT.test(c))).length;
    const score = agree * 10 + max * 0.1 + (whole / sample.length) * 3;
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
    // "Team ID" is deliberately absent: an LMS writes a database key under that
    // label, and a five-digit group_id is not what anyone means by team 3.
    team: find(/^(team|group|table|pod|squad)s? ?(#|no\.?|num(ber)?|assignment)?$/i),
  };
}

/** "Doe, Jane" → "Jane Doe"; "Doe, Jane Marie" → "Jane Marie Doe". Leaves the rest alone. */
function normalizeName(raw: string): string {
  let s = clean(raw).replace(/\s+/g, " ");
  if (!s) return "";

  // "Ada Lovelace <ada@x.edu>" → "Ada Lovelace"
  s = s.replace(/<[^>]*>/g, "").trim();
  if (EMAIL_EXACT.test(s)) return "";

  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  // "King, Martin Luther, Jr." → "Martin Luther King, Jr." — the suffix trails
  // the whole name, it is not a middle name.
  if (parts.length === 3 && SUFFIX_RE.test(parts[2])) {
    return `${parts[1]} ${parts[0]}, ${parts[2]}`;
  }
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (m) {
    const left = m[1].trim();
    const right = m[2].trim();
    // "King, Jr." is one name with a suffix, not "Jr. King".
    if (right && left && !SUFFIX_RE.test(right)) return `${right} ${left}`;
  }
  return s;
}

/** Cells that are class metadata rather than any part of a person's name. */
const NON_NAME_RE =
  /^(section|sec|group|team|lab|period|room|block|cohort|status|active|inactive|enrolled|dropped|waitlist(ed)?|yes|no|n\/?a|male|female|other|grade|year)\b/i;

/** Lowercase particles that are part of a surname, not a given name. */
const PARTICLE_RE = /^(van|von|der|den|de|del|della|di|da|dos|du|la|le|el|al|bin|ibn|ben|mac|mc|st\.?|ter|ten)$/i;

/**
 * Could this cell be the surname half of "Surname, Given"? One token, or a run
 * of particles before one token ("van der Berg"). Crucially "Ada Lovelace" is
 * NOT a surname, which is what separates a real inverted list from two people
 * on one line.
 */
function looksLikeSurname(cell: string): boolean {
  const t = cell.split(/\s+/).filter(Boolean);
  return t.length > 0 && t.slice(0, -1).every((x) => PARTICLE_RE.test(x));
}

const tokenCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Cells that are clearly identifiers rather than a person's name. */
function isNameLike(s: string): boolean {
  if (!s) return false;
  if (EMAIL_RE.test(s)) return false;
  if (/^[\d\s.+\-()]+$/.test(s)) return false; // ids, phone numbers
  if (/^[0-9a-f-]{16,}$/i.test(s)) return false; // uuids
  if (!/[A-Za-zÀ-ɏ]/.test(s)) return false; // must contain a letter
  return true;
}

/** "3", "#3", "Team 3", "Group #3", "Table 7" — a spreadsheet writes the number all of these ways. */
const TEAM_NUMBER_RE = /^(?:(team|group|table|pod|squad)s? ?)?#? ?(\d{1,6})$/i;
/**
 * "Team Red", "Group Helix" — plainly meant as a team, but there is no number in
 * it. The separator is required: "Teamwork" is a word, not a team called Work.
 */
const TEAM_NAMED_RE = /^(team|group|table|pod|squad)s?[ #]+\S+/i;

type TeamCell =
  | { kind: "blank" }
  | { kind: "number"; value: number; labelled: boolean }
  | { kind: "named" }
  | { kind: "other" };

function readTeamCell(raw: string): TeamCell {
  const s = clean(raw);
  if (!s) return { kind: "blank" };
  const m = TEAM_NUMBER_RE.exec(s);
  if (m) return { kind: "number", value: Number(m[2]), labelled: Boolean(m[1]) };
  if (TEAM_NAMED_RE.test(s)) return { kind: "named" };
  return { kind: "other" };
}

/** Nobody runs a class of eighty with a three-digit team number. */
const MAX_INFERRED_TEAM = 99;

/**
 * Which column holds the team, in a file that named none of its columns.
 *
 * A cell that says "Team 3" or "Team Red" needs no guessing — nothing else in a
 * roster spells the word out — so such a column is taken as the team whatever
 * else is in the file, and a named one is reported rather than turned into a
 * number by the caller.
 *
 * A column of bare numbers has to earn it. The rule: every filled cell is a
 * whole number from 1 to 99, there are at least two distinct values, and at
 * least one of them repeats. The repetition is the load-bearing half — teams
 * repeat by definition, twenty of them over eighty students, while the columns
 * that would otherwise qualify do not. It therefore refuses, on purpose:
 *
 *   - a row number, which counts 1, 2, 3 to the end of the file (all distinct);
 *   - a short student id, likewise distinct per student;
 *   - a 0/1 or all-1s flag column such as "enrolled" (the floor of 1 and the
 *     need for two distinct values between them);
 *   - a year, a phone number and a long id, all far over the ceiling;
 *   - a class where every student really is on their own team, which is
 *     indistinguishable from an id column — inventing eighty teams from a
 *     column of ids is much worse than inventing none.
 *
 * A section number of 1 and 2 is genuinely indistinguishable from two teams, so
 * the caller warns that it guessed and the preview shows the result.
 */
function inferTeamColumn(rows: string[][]): { index: number; explicit: boolean } {
  const none = { index: -1, explicit: false };
  const width = Math.max(0, ...rows.map((r) => r.length));
  // Numbers are only team numbers next to people; a bare column of figures is
  // not a roster at all.
  if (width < 2 || !rows.some((r) => r.some((v) => isNameLike(v) && !NON_NAME_RE.test(v)))) {
    return none;
  }

  let explicit = -1;
  let numeric = -1;
  for (let c = 0; c < width; c++) {
    const filled = rows.map((r) => readTeamCell(r[c] ?? "")).filter((t) => t.kind !== "blank");
    if (!filled.length || filled.some((t) => t.kind === "other")) continue;
    if (filled.some((t) => t.kind === "named" || (t.kind === "number" && t.labelled))) {
      explicit = c;
      continue;
    }
    const values = filled.map((t) => (t.kind === "number" ? t.value : 0));
    const distinct = new Set(values).size;
    if (
      values.length >= 2 &&
      Math.min(...values) >= 1 &&
      Math.max(...values) <= MAX_INFERRED_TEAM &&
      distinct >= 2 &&
      distinct < values.length
    ) {
      numeric = c;
    }
  }
  // Rightmost wins: a team spreadsheet reads name, email, team, and a number to
  // the LEFT of the names is far likelier to be something else.
  if (explicit >= 0) return { index: explicit, explicit: true };
  return numeric >= 0 ? { index: numeric, explicit: false } : none;
}

function emailIn(cells: string[]): string {
  for (const c of cells) {
    const m = EMAIL_RE.exec(c);
    if (m) return m[0];
  }
  return "";
}

/** "mailto:ada@x.edu" and stray punctuation would never match a real login. */
function cleanEmail(raw: string): string {
  return raw.replace(/^mailto:/i, "").replace(/[.,;]+$/, "").trim().toLowerCase();
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
  // like a 2-column CSV. Telling the two apart takes positive evidence, because
  // guessing wrong reverses every name in the class — and the absence of emails
  // and digits is not evidence: a headerless "Ada,Lovelace" has none either, and
  // neither does "Ada Lovelace, Grace Hopper", which is two people on one line.
  //
  // What an inverted list actually looks like: a surname before the comma, a
  // space after it, and nothing that is class metadata on the right.
  if (delim === ",") {
    const flat = lines.join(" ");
    const bare = !EMAIL_RE.test(flat) && !/\d/.test(flat) && !looksLikeHeader(rows[0]);
    const multi = rows.map((r, i) => ({ r, line: lines[i].trim() })).filter((x) => x.r.length > 1);
    const inverted =
      multi.length > 0 &&
      rows.every((r) => r.length <= 3) &&
      multi.every(
        ({ r, line }) =>
          /,\s/.test(line) && // "Lovelace, Ada" — not "Ada,Lovelace"
          !/,\S/.test(line) &&
          looksLikeSurname(r[0]) && // "Ada Lovelace, ..." is not a surname
          !NON_NAME_RE.test(r[1] ?? ""), // "Ada Lovelace, Section A" is not a name
      );
    if (bare && inverted) {
      delim = "\u0000"; // a delimiter no roster contains
      // Re-join the PARSED cells rather than re-splitting the raw line: going
      // back to the line threw away the quote-aware parse and turned
      // '"Lovelace, Ada",Ada' into 'Ada",Ada "Lovelace'.
      rows = rows.map((r) => [clean(r.join(", "))]);
      warnings.push("Read as “Last, First”, so “Lovelace, Ada” is imported as “Ada Lovelace”.");
    }
  }

  // The header is usually the first line, but exports often put a title or a
  // blank-ish preamble above it. Look a little way down.
  let cols = { name: -1, first: -1, last: -1, email: -1, team: -1 };
  let start = 0;
  const detected: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (looksLikeHeader(rows[i])) {
      const found = findColumns(rows[i]);
      if (found.name >= 0 || (found.first >= 0 && found.last >= 0) || found.email >= 0) {
        cols = found;
        start = i + 1;
        if (found.name >= 0) detected.push("name");
        if (found.first >= 0 && found.last >= 0) detected.push("first + last");
        if (i > 0) warnings.push(`Ignored ${i} line${i === 1 ? "" : "s"} above the header.`);
        // Only a header we can actually use ends the search. A decorative row
        // ("Course,Section") looks like one but names no column, and breaking
        // on it turned the real header and everything above it into students.
        break;
      }
    }
  }

  const noHeader = cols.name < 0 && cols.first < 0 && cols.last < 0;
  let joinedColumns = false;
  let ignoredColumns = false;

  // Only guess at a team column when the file named none of its columns. A
  // header that says "Name,Email" and nothing else has already answered the
  // question, and a roster import must keep parsing exactly as it did before.
  // Junk rows go first, so "Showing 1-80 of 80" cannot poison a column.
  const inferredTeam =
    cols.team < 0 && noHeader
      ? inferTeamColumn(rows.slice(start).filter((r) => !JUNK_ROW_RE.test(r.join(" ").trim())))
      : null;
  const teamCol = cols.team >= 0 ? cols.team : (inferredTeam?.index ?? -1);
  // A column that says "Team 3" in words was not guessed at, so do not go on to
  // tell the instructor it was.
  const guessedTeam = Boolean(inferredTeam && inferredTeam.index >= 0 && !inferredTeam.explicit);
  const unreadableTeams: string[] = [];

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
      // No usable header: the name is the cell that reads like one, ignoring
      // section/status columns that read like one but are not.
      // Skipping the team column matters for the cells that spell it out: "Ada,
      // Table 7" would otherwise fuse into a student called Ada Table 7.
      const nameLike = cells.filter((c, ci) => ci !== teamCol && isNameLike(c) && !NON_NAME_RE.test(c));
      name = nameLike[0] ?? "";
      if (noHeader && nameLike.length > 1) {
        // A headerless "Ada,Lovelace" would otherwise import as "Ada". Join the
        // parts only when together they read as ONE person; "Ada Lovelace,
        // Grace Hopper" is four tokens and two people, so it is left alone
        // rather than fused into a person who does not exist.
        if (tokenCount(nameLike.join(" ")) <= 3 && !nameLike.some((c) => c.includes(","))) {
          name = nameLike.join(" ");
          joinedColumns = true;
        } else {
          ignoredColumns = true;
        }
      }
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

    const student: ParsedStudent = email ? { name, email: cleanEmail(email) } : { name };
    if (teamCol >= 0) {
      const cell = readTeamCell(cells[teamCol] ?? "");
      // A blank cell and an unreadable one both mean the same thing to the app —
      // this student is on no team — but only the second is worth telling the
      // instructor about.
      student.team = cell.kind === "number" ? cell.value : null;
      if (cell.kind === "named" || cell.kind === "other") unreadableTeams.push(cells[teamCol]);
    }
    students.push(student);
  }

  if (skipped) warnings.push(`Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no name.`);
  // The file had no header, so both of these are guesses. Say so — the preview
  // shows the resulting names and the instructor can see at a glance if a guess
  // was wrong.
  if (joinedColumns) {
    warnings.push("No header row — the first two columns were read as one name.");
  }
  if (ignoredColumns) {
    warnings.push(
      "No header row — the first column was read as the name and the rest ignored. " +
        "Add a “Name,Email” header row if that is wrong.",
    );
  }

  // De-duplicate conservatively. Only a row that is genuinely the same person is
  // dropped: same name AND a compatible address. Two students who share a name
  // but have different addresses are two students, and two names sharing one
  // address are probably siblings — dropping either loses a real person, which
  // is far worse than importing a row the instructor can delete.
  const kept: ParsedStudent[] = [];
  let dupes = 0;
  for (const s of students) {
    const n = s.name.toLowerCase();
    const twin = kept.find(
      (k) => k.name.toLowerCase() === n && (!k.email || !s.email || k.email === s.email),
    );
    if (twin) {
      // Prefer the copy that carries an address, and the one that carries a team.
      if (!twin.email && s.email) twin.email = s.email;
      if (twin.team == null && s.team != null) twin.team = s.team;
      dupes++;
      continue;
    }
    kept.push({ ...s });
  }
  const unique = kept;
  if (dupes) warnings.push(`Removed ${dupes} duplicate${dupes === 1 ? "" : "s"} from the file.`);

  // Two different people cannot share one address: a student signs in with it,
  // and it would be ambiguous which roster row they are.
  const byEmail = new Map<string, string[]>();
  unique.forEach((s) => {
    if (!s.email) return;
    byEmail.set(s.email, [...(byEmail.get(s.email) ?? []), s.name]);
  });
  const shared = [...byEmail.entries()].filter(([, who]) => who.length > 1);
  if (shared.length) {
    warnings.push(
      `${shared.length} address${shared.length === 1 ? " is" : "es are"} used by more than one ` +
        `student (${shared[0][1].join(", ")}${shared.length > 1 ? ", …" : ""}). ` +
        "They were all kept, but each student needs their own address to sign in.",
    );
  }

  // Two students genuinely sharing a name is fine, but worth flagging so the
  // instructor can tell them apart on the roster.
  const nameCounts = new Map<string, number>();
  unique.forEach((s) => nameCounts.set(s.name.toLowerCase(), (nameCounts.get(s.name.toLowerCase()) ?? 0) + 1));
  const sameName = [...nameCounts.values()].filter((n) => n > 1).length;
  if (sameName) {
    warnings.push(`${sameName} name${sameName === 1 ? " is" : "s are"} shared by more than one student — both kept.`);
  }

  // Whatever produced them — a file read as UTF-8 that was not, or a paste out
  // of a document that was already mangled — these names are wrong on screen
  // and wrong in the gradebook, and nothing later in the app can repair them.
  const mangled = unique.filter((s) => s.name.includes("\ufffd"));
  if (mangled.length) {
    warnings.push(
      `${mangled.length} name${mangled.length === 1 ? " has" : "s have"} a character that could ` +
        `not be read (${mangled.slice(0, 2).map((s) => `“${s.name}”`).join(", ")}` +
        `${mangled.length > 2 ? ", …" : ""}). Fix them in the file and re-save it as “CSV UTF-8”.`,
    );
  }

  const withEmail = unique.filter((s) => s.email).length;
  // Only claim an email column once it actually produced an address — an LMS
  // "SIS Login ID" matches the header but holds usernames.
  if (withEmail > 0) detected.push("email");
  const withTeam = unique.filter((s) => typeof s.team === "number").length;
  if (withTeam > 0) detected.push("team");
  if (guessedTeam && withTeam > 0) {
    warnings.push(
      "No header row — a column of numbers was read as the team. " +
        "Add a “Team” header row if that is wrong.",
    );
  }
  // A team is a number here. Numbering "Red" and "Helix" ourselves would put
  // students on teams nobody chose, and the numbers would differ every time the
  // file was imported — so name what was dropped and leave those rows unassigned.
  if (unreadableTeams.length) {
    const distinct = [...new Set(unreadableTeams)];
    const shown = distinct.slice(0, 2).map((v) => `“${v}”`).join(", ");
    warnings.push(
      `${unreadableTeams.length} row${unreadableTeams.length === 1 ? "" : "s"} came in with no ` +
        `team because the team is not a number (${shown}${distinct.length > 2 ? ", …" : ""}). ` +
        "Number your teams and import again.",
    );
  }
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
