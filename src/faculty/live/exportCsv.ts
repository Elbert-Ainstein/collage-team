// Team scores as a CSV: one row per team, its members, the score, and its
// tries at each question in order ("C → B": wrong, then right).

import { mmss, type LiveModel } from "@/live/model";

/**
 * A spreadsheet reads a cell starting with = + - @ as a formula. A plain
 * number ("-9.8", an answer) is left alone so it stays a number.
 */
const cell = (v: string | number | null): string => {
  const s = v === null ? "" : String(v);
  const formula = /^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s));
  const safe = formula ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function teamCsv(m: LiveModel): string {
  const head = ["Team", "Members", "Score", "Out of", "Time", ...m.questions.map((_, i) => `Q${i + 1}`)];
  const rows = m.teams.map((t) => {
    const finished = m.finishedAt(t.id);
    return [
      t.name,
      t.members.map((s) => s.name).join("; "),
      m.score(t.id),
      m.questions.length,
      finished === null ? "" : mmss(finished),
      ...m.questions.map((_, q) => m.tries(t.id, q).map((a) => a.answer).join(" → ")),
    ];
  });
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

export function exportTeamCsv(title: string, m: LiveModel): void {
  // The BOM is what makes Excel read it as UTF-8, so accented names survive.
  const blob = new Blob(["\uFEFF", teamCsv(m)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, "").trim() || "live-questions"} - team scores.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
