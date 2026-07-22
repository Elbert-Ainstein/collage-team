// rosterService — the CSV → map → validate → confirm import flow (§6.3), all
// client-side. On confirm it MERGES: existing members are matched by email so
// ids referenced elsewhere (e.g. Team 3) are preserved ("historical team records").

import type { Member, Team } from "@/types";
import { useStore } from "@/store";
import { LIAM, MAYA, PRIYA, SAM } from "@/seed";

export const ROSTER_FIELDS = [
  { key: "ignore", label: "Ignore column" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "student_id", label: "Student ID" },
  { key: "team", label: "Team" },
  { key: "section", label: "Section" },
  { key: "role", label: "Role" },
] as const;

export type FieldKey = (typeof ROSTER_FIELDS)[number]["key"];

const TINTS = ["#0382ed", "#8a3ffc", "#0e7c57", "#ff6713", "#b45309", "#7c3aed", "#0369a1", "#b91c1c"];

// A realistic sample roster: Team 3's real members (matched by email on import) +
// 20 others across 6 teams, with two flagged rows (missing email, two teams).
const ROWS: Array<[string, string, string, string, string]> = [
  // first, last, email, id, team
  ["Maya", "Chen", "maya.chen@harvard.edu", "S001", "Team 3"],
  ["Liam", "Ortiz", "liam.ortiz@harvard.edu", "S002", "Team 3"],
  ["Priya", "Nair", "priya.nair@harvard.edu", "S003", "Team 3"],
  ["Sam", "Whitfield", "sam.whitfield@harvard.edu", "S004", "Team 3"],
  ["Ava", "Johnson", "ava.johnson@harvard.edu", "S005", "Team 1"],
  ["Noah", "Kim", "noah.kim@harvard.edu", "S006", "Team 1"],
  ["Mia", "Patel", "mia.patel@harvard.edu", "S007", "Team 1"],
  ["Ethan", "Rossi", "ethan.rossi@harvard.edu", "S008", "Team 1"],
  ["Sofia", "Garcia", "sofia.garcia@harvard.edu", "S009", "Team 2"],
  ["Lucas", "Meyer", "lucas.meyer@harvard.edu", "S010", "Team 2"],
  ["Zoe", "Nguyen", "zoe.nguyen@harvard.edu", "S011", "Team 2"],
  ["Omar", "Haddad", "omar.haddad@harvard.edu", "S012", "Team 2"],
  ["Ella", "Brown", "ella.brown@harvard.edu", "S013", "Team 4"],
  ["Jack", "Wilson", "jack.wilson@harvard.edu", "S014", "Team 4"],
  ["Aria", "Silva", "aria.silva@harvard.edu", "S015", "Team 4"],
  ["Leo", "Fischer", "", "S016", "Team 4"], // ← missing email
  ["Nora", "Ahmed", "nora.ahmed@harvard.edu", "S017", "Team 5"],
  ["Ben", "Carter", "ben.carter@harvard.edu", "S018", "Team 5"],
  ["Ivy", "Larsen", "ivy.larsen@harvard.edu", "S019", "Team 5"],
  ["Max", "Turner", "max.turner@harvard.edu", "S020", "Team 3 / Team 4"], // ← two teams
  ["Ruby", "Evans", "ruby.evans@harvard.edu", "S021", "Team 6"],
  ["Finn", "Walsh", "finn.walsh@harvard.edu", "S022", "Team 6"],
  ["Lily", "Hansen", "lily.hansen@harvard.edu", "S023", "Team 6"],
  ["Kai", "Moreau", "kai.moreau@harvard.edu", "S024", "Team 6"],
];

const EXISTING_BY_EMAIL: Record<string, Member> = {
  [MAYA.email!]: MAYA,
  [LIAM.email!]: LIAM,
  [PRIYA.email!]: PRIYA,
  [SAM.email!]: SAM,
};

export const SAMPLE_CSV_HEADERS = ["first_name", "last_name", "email", "student_id", "team"];

export function sampleCsvRows(): string[][] {
  return ROWS.map((r) => r.slice());
}

export interface ParsedRow {
  index: number;
  first: string;
  last: string;
  email: string;
  studentId: string;
  team: string;
  warnings: string[];
}

export function parseAndValidate(rows: string[][], mapping: FieldKey[]): ParsedRow[] {
  const col = (r: string[], key: FieldKey) => {
    const i = mapping.indexOf(key);
    return i === -1 ? "" : (r[i] ?? "").trim();
  };
  return rows.map((r, index) => {
    const email = col(r, "email");
    const team = col(r, "team");
    const warnings: string[] = [];
    if (!email) warnings.push("No email");
    if (team.includes("/")) warnings.push("Two teams");
    return {
      index,
      first: col(r, "first_name"),
      last: col(r, "last_name"),
      email,
      studentId: col(r, "student_id"),
      team,
      warnings,
    };
  });
}

export interface ValidationStats {
  valid: number;
  needAttention: number;
  teams: number;
  missingEmail: number;
}

export function stats(parsed: ParsedRow[]): ValidationStats {
  const teams = new Set(parsed.map((p) => p.team.split("/")[0].trim()).filter(Boolean));
  return {
    valid: parsed.filter((p) => p.warnings.length === 0).length,
    needAttention: parsed.filter((p) => p.warnings.length > 0).length,
    teams: teams.size,
    missingEmail: parsed.filter((p) => p.warnings.includes("No email")).length,
  };
}

// Commit: preserve existing members by email; add the rest; rebuild teams from
// the (first) team column. Under-target teams surface a warning in the UI.
export function applyImport(parsed: ParsedRow[]): { members: number; teams: number } {
  const members: Member[] = [];
  const teamMap = new Map<string, string[]>(); // team name -> memberIds

  parsed.forEach((p, i) => {
    const existing = EXISTING_BY_EMAIL[p.email];
    const id = existing?.id ?? `m-${p.studentId || i}`;
    const member: Member =
      existing ?? {
        id,
        name: `${p.first} ${p.last}`.trim(),
        initials: `${p.first[0] ?? ""}${p.last[0] ?? ""}`.toUpperCase(),
        avatarTint: TINTS[i % TINTS.length],
        email: p.email || undefined,
      };
    members.push(member);
    const teamName = p.team.split("/")[0].trim();
    if (teamName) {
      const arr = teamMap.get(teamName) ?? [];
      arr.push(id);
      teamMap.set(teamName, arr);
    }
  });

  const teams: Team[] = [...teamMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([name, memberIds]) => {
      const number = parseInt(name.replace(/\D/g, ""), 10) || 0;
      return {
        id: `team-${number}`,
        number,
        name,
        memberIds,
        locked: false,
        recorderId: number === 3 ? MAYA.id : memberIds[0],
        targetSize: 4,
      };
    });

  useStore.getState()._setRoster(members, teams);
  return { members: members.length, teams: teams.length };
}
