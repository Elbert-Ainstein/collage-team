// One conversation with the assistant, as the panel keeps it.

import type { Proposal, Turn } from "@/assistant/types";
import type { SeatRecord } from "./seating";
import type { Refs } from "./snapshot";

/** What became of a draft. Only the instructor moves it on from "open". */
export type DraftStatus = "open" | "applied" | "undone" | "dismissed" | "handed-off";

export interface Entry {
  id: number;
  role: "user" | "assistant";
  text: string;
  proposal?: Proposal;
  /** The refs the draft was written against — see snapshot.ts. */
  refs?: Refs;
  status?: DraftStatus;
  /** What Apply (or Undo) did, in words, once it has. */
  outcome?: string;
  /** What Apply wrote, kept so Undo can put it back. */
  record?: SeatRecord;
  /** For a class list: addresses in it that she never wrote. See emailsNotIn. */
  unseen?: string[];
  /** The request failed; shown in place of an answer, never sent back. */
  error?: string;
}

/** Enough to follow "and Alan too" without re-sending a whole term of chat. */
export const MAX_HISTORY = 12;

const NOTE: Record<DraftStatus, string> = {
  open: "Shown to the instructor; not applied yet.",
  applied: "The instructor applied this draft. It has an Undo button.",
  undone: "The instructor undid this draft; what it changed was put back.",
  dismissed: "The instructor discarded this draft.",
  "handed-off":
    "Opened in the Teams importer for the instructor to review. Once imported, it is undone with " +
    '"Undo this import" at the top of Roster & teams.',
};

/**
 * The turns to send with the next message.
 *
 * Each draft carries what became of it, because "now do the same for team 4"
 * means something different after an Apply than after a Discard, and the model
 * cannot see the buttons.
 */
export function historyFor(entries: Entry[]): Turn[] {
  return entries
    .filter((e) => !e.error)
    .map((e) => ({
      role: e.role,
      text: e.proposal && e.status ? `${e.text}\n[${NOTE[e.status]}]` : e.text,
    }))
    .slice(-MAX_HISTORY);
}
