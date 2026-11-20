// A 1–5 line with where someone stands on it: their teammates' average
// (a teal diamond, the line filled up to it) and what they gave themselves
// (a navy dot). One shape for the instructor's cards and panel and the
// student's results, so the picture means the same everywhere.

const at = (v: number) => `${((Math.min(5, Math.max(1, v)) - 1) / 4) * 100}%`;

export function ScoreTrack({
  team,
  self,
  size = "md",
  label,
}: {
  /** Teammates' average; null when nobody has rated them. */
  team: number | null;
  /** Their own score; null when they haven't submitted. */
  self?: number | null;
  size?: "sm" | "md";
  label?: string;
}) {
  const low = team !== null && team < 3;
  return (
    <span className={`te-track ${size}${low ? " low" : ""}`} role="img" aria-label={label}>
      <span className="te-trackline" />
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="te-tracktick" style={{ left: at(n) }} />
      ))}
      {team !== null ? <span className="te-trackfill" style={{ width: at(team) }} /> : null}
      {team !== null ? <span className="te-trackteam" style={{ left: at(team) }} /> : null}
      {self !== null && self !== undefined ? <span className="te-trackself" style={{ left: at(self) }} title={`Self ${self}`} /> : null}
    </span>
  );
}
