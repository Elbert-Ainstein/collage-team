import { describe, expect, it } from "vitest";
import type { Proposal } from "@/assistant/types";
import { historyFor, MAX_HISTORY, type Entry } from "./thread";

const seat: Proposal = { kind: "seat", summary: "Moves Ada.", moves: [], renames: [], unresolved: [] };
const refs = { students: new Map(), teams: new Map() };

describe("historyFor", () => {
  it("tells the model what became of each draft", () => {
    const entries: Entry[] = [
      { id: 1, role: "user", text: "Move Ada" },
      { id: 2, role: "assistant", text: "Moves Ada.", proposal: seat, refs, status: "applied" },
      { id: 3, role: "user", text: "And Alan" },
      { id: 4, role: "assistant", text: "Moves Alan.", proposal: seat, refs, status: "dismissed" },
      { id: 5, role: "assistant", text: "Rows ready.", proposal: { kind: "import", summary: "x", rows: [] }, refs, status: "handed-off" },
      { id: 6, role: "assistant", text: "Moves Grace.", proposal: seat, refs, status: "undone" },
    ];
    expect(historyFor(entries)).toEqual([
      { role: "user", text: "Move Ada" },
      { role: "assistant", text: "Moves Ada.\n[The instructor applied this draft. It has an Undo button.]" },
      { role: "user", text: "And Alan" },
      { role: "assistant", text: "Moves Alan.\n[The instructor discarded this draft.]" },
      {
        role: "assistant",
        text:
          "Rows ready.\n[Opened in the Teams importer for the instructor to review. Once imported, it is undone " +
          'with "Undo this import" at the top of Roster & teams.]',
      },
      { role: "assistant", text: "Moves Grace.\n[The instructor undid this draft; what it changed was put back.]" },
    ]);
  });

  it("leaves out failed requests, and keeps only the most recent turns", () => {
    const many: Entry[] = Array.from({ length: MAX_HISTORY + 6 }, (_, i) => ({
      id: i,
      role: i % 2 ? "assistant" : "user",
      text: `t${i}`,
    }));
    const withError: Entry[] = [...many, { id: 999, role: "assistant", text: "", error: "busy" }];
    const out = historyFor(withError);
    expect(out).toHaveLength(MAX_HISTORY);
    expect(out.at(-1)?.text).toBe(`t${MAX_HISTORY + 5}`);
  });
});
