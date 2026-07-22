import { useEffect, useState } from "react";
import { memberById, teamOfMember, useStore } from "@/store";
import type { Member } from "@/types";

// Simulated presence for the collective workspace (§7.6). No websocket server
// exists (frontend-only); this deterministically cycles an "X is editing" note
// among teammates so the soft-lock UI is demoable. Real multi-client sync is a
// v1.1 item behind this same shape (see DECISIONS.md D4).
export function usePresence(selfId: string): { present: Member[]; editing: Member | null } {
  const team = useStore((s) => teamOfMember(s, selfId));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3200);
    return () => clearInterval(id);
  }, []);

  if (!team) return { present: [], editing: null };
  const state = useStore.getState();
  const present = team.memberIds.map((mid) => memberById(state, mid)).filter((m): m is Member => !!m);
  const teammates = present.filter((m) => m.id !== selfId);
  // Cycle through teammates; every 3rd tick nobody is "editing" (idle beat).
  const slot = tick % (teammates.length + 1);
  const editing = slot < teammates.length ? teammates[slot] : null;
  return { present, editing };
}
