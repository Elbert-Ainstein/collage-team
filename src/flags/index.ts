// Feature flags for the pilot build. Every ◇ (deferred) surface sits behind a
// TEAM_MODULE_* flag so the classroom beta can hide it cleanly. Flags default
// OFF for deferred features → they render a real-layout "coming soon" stub.
//
// To force a flag on for a build, add a static NEXT_PUBLIC_* read below (Next only
// inlines statically-referenced env vars).

type FlagKey =
  | "TEAM_MODULE_AI_GENERATION"
  | "TEAM_MODULE_TEAM_FORMATION"
  | "TEAM_MODULE_LIVE_CONTROLS"
  | "TEAM_MODULE_ORAL"
  | "TEAM_MODULE_RESULTS"
  | "TEAM_MODULE_PEER_EVAL";

const DEFAULTS: Record<FlagKey, boolean> = {
  TEAM_MODULE_AI_GENERATION: false,
  TEAM_MODULE_TEAM_FORMATION: false,
  TEAM_MODULE_LIVE_CONTROLS: false,
  TEAM_MODULE_ORAL: false,
  TEAM_MODULE_RESULTS: false,
  TEAM_MODULE_PEER_EVAL: false,
};

// Static per-flag overrides (extend as the pilot needs to reveal a stub).
const OVERRIDES: Partial<Record<FlagKey, boolean>> = {
  TEAM_MODULE_AI_GENERATION: parseFlag(process.env.NEXT_PUBLIC_TEAM_MODULE_AI_GENERATION),
  TEAM_MODULE_ORAL: parseFlag(process.env.NEXT_PUBLIC_TEAM_MODULE_ORAL),
};

function parseFlag(v: string | undefined): boolean | undefined {
  if (v === "on" || v === "true" || v === "1") return true;
  if (v === "off" || v === "false" || v === "0") return false;
  return undefined;
}

export function flag(key: FlagKey): boolean {
  return OVERRIDES[key] ?? DEFAULTS[key];
}

export type { FlagKey };
