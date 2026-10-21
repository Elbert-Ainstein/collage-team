// Small pieces both sides of live questions draw: avatars, answer chips,
// the live dot, and the stroked icon set (inline, so nothing is fetched).

import { initials, tintFor } from "@/checkins/data";

interface Person {
  id: string;
  name: string;
  avatar_tint?: string | null;
}

export function Av({ p, size = 24, dim = false, ring = false }: { p: Person; size?: number; dim?: boolean; ring?: boolean }) {
  return (
    <span
      className={`lq-av${dim ? " dim" : ""}${ring ? " ring" : ""}`}
      style={{ width: size, height: size, background: p.avatar_tint ?? tintFor(p.name), fontSize: Math.max(9, Math.round(size * 0.4)) }}
      title={p.name}
      aria-label={p.name}
    >
      {initials(p.name)}
    </span>
  );
}

/**
 * One answer, as a chip. `right` marks it right or wrong; leave it undefined
 * (or null, when the key isn't known) and it's just the answer.
 */
export function Pick({
  value,
  right,
  size = "md",
}: {
  value: string | null;
  right?: boolean | null;
  size?: "sm" | "md" | "lg";
}) {
  if (!value) {
    return (
      <span className={`lq-pick ${size} none`} title="No answer">
        –
      </span>
    );
  }
  const verdict = right === true ? "right" : right === false ? "wrong" : "";
  return (
    <span className={`lq-pick ${size} ${verdict}`} title={value}>
      <span className="lq-pickv">{value}</span>
      {verdict === "right" ? <Tick /> : verdict === "wrong" ? <Cross /> : null}
    </span>
  );
}

export function Tick({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-label="correct" className="lq-mark">
      <path d="M2.5 6.4l2.3 2.3L9.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Cross({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-label="incorrect" className="lq-mark">
      <path d="M3.4 3.4l5.2 5.2M8.6 3.4L3.4 8.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function LiveDot({ tone = "live" }: { tone?: "live" | "team" | "done" }) {
  return <span className={`lq-livedot ${tone}`} aria-hidden="true" />;
}

const PATHS: Record<string, string> = {
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
  groups:
    '<circle cx="9" cy="8" r="3"/><path d="M3.4 19c0-2.9 2.6-4.8 5.6-4.8s5.6 1.9 5.6 4.8"/><path d="M16.2 5.7a3 3 0 0 1 0 5.7"/><path d="M18.9 19c0-2-.9-3.5-2.4-4.5"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.5 4 2.5 4H5.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff:
    '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.6A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.9-.9"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  undo: '<path d="M8 8H4V4"/><path d="M4.4 8A8.5 8.5 0 1 1 3.5 13"/>',
  assignment:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  check: '<path d="M4.5 12.5l5 5L20 6.5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.6A2 2 0 0 0 13 4H6a2 2 0 0 0-2 2v7a2 2 0 0 0 1.6 2"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M15 6l3 3"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  file: '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/>',
  upload: '<path d="M12 16V4"/><path d="M8 7.5L12 3.5l4 4"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  school:
    '<path d="M12 4L2.5 9 12 14l9.5-5z"/><path d="M6.5 11.3V16c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-4.7"/><path d="M21.5 9v5"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  minimize: '<path d="M6 9l6 6 6-6"/>',
  maximize: '<path d="M6 15l6-6 6 6"/>',
};

export function Ic({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none" }}
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? "" }}
    />
  );
}

/** "3 on B · Sam on C", the room's shorthand for where a team stands. */
export function voteSummary(votes: (string | null)[], names: string[]): string {
  const counts = new Map<string, string[]>();
  votes.forEach((v, i) => {
    if (v) counts.set(v, [...(counts.get(v) ?? []), names[i]]);
  });
  const waiting = votes.filter((v) => !v).length;
  const parts = [...counts.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([l, who]) => (who.length === 1 ? `${who[0]} on ${l}` : `${who.length} on ${l}`));
  if (waiting) parts.push(`${waiting} undecided`);
  return parts.join(" · ") || "No votes yet";
}
