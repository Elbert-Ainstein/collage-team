// Feature flags for the pilot build. Every ◇ (deferred) surface sits behind a
// TEAM_MODULE_* flag so the classroom beta can hide it cleanly. Flags default
// OFF for deferred features → they render a real-layout "coming soon" stub.
//
// Override in dev via Vite env, e.g. VITE_TEAM_MODULE_ORAL=on

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

function read(key: FlagKey): boolean {
  const env = import.meta.env?.[`VITE_${key}`];
  if (env === "on" || env === "true" || env === "1") return true;
  if (env === "off" || env === "false" || env === "0") return false;
  return DEFAULTS[key];
}

export function flag(key: FlagKey): boolean {
  return read(key);
}

export type { FlagKey };
