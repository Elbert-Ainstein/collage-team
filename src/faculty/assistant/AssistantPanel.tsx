"use client";

// The assistant: describe a change to the teams, or paste a class list, and it
// drafts it. Nothing is written until the instructor presses the button on the
// draft — see src/assistant/types.ts for why the server cannot write at all.
//
// Kept mounted while closed, so the conversation survives a trip to another
// screen and back. A course switch starts a new one (FacultyApp keys this on
// the course), because every ref in the old one points at the other class.

import { useEffect, useRef, useState } from "react";
import { decodeRosterFile, isSupportedRosterFile } from "@/checkins/rosterImport";
import { MAX_MESSAGE } from "@/assistant/request";
import type { FacultyData } from "../FacultyApp";
import { FIcon } from "../icons";
import { askAssistant } from "./client";
import { ImportCard } from "./ImportCard";
import { emailsNotIn, rowsToCsv } from "./importRows";
import { SeatingCard } from "./SeatingCard";
import { buildSnapshot } from "./snapshot";
import { historyFor, type DraftStatus, type Entry } from "./thread";
import "./assistant.css";

/** What the importer's preview says the rows came from. */
export const IMPORT_SOURCE = "the assistant's reading of your list";

/**
 * When the panel is a sheet over the screen rather than docked beside it.
 * Mirrors the breakpoint in assistant.css: as a sheet it would cover the
 * importer it just opened, so FacultyApp closes it on a hand-off.
 */
export const SHEET_QUERY = "(max-width: 1279px)";

interface AssistantPanelProps {
  data: FacultyData;
  hidden: boolean;
  onClose: () => void;
  /** A draft was applied; the class needs re-reading. */
  onChanged: () => void;
  /** Hand a class list to the Teams screen's importer. */
  onImport: (text: string, source: string) => void;
}

function tries(data: FacultyData): string[] {
  const someone = data.roster[0]?.name.split(" ")[0];
  const somewhere = data.teams[1]?.name ?? data.teams[0]?.name;
  return [
    "Who isn't on a team yet?",
    someone && somewhere ? `Move ${someone} to ${somewhere}` : "Move a student to another team",
    "Change the teams to match this list:\n",
  ];
}

/** On a touch screen Return is the only way to start a new line, so it must not send. */
const touch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export function AssistantPanel(props: AssistantPanelProps): JSX.Element {
  const { data, hidden } = props;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const nextId = useRef(1);
  const inFlight = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  /** Read when an answer lands, which may be after she has moved on. */
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  useEffect(() => () => inFlight.current?.abort(), []);
  useEffect(() => {
    if (!hidden) box.current?.focus();
  }, [hidden]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [entries, busy]);

  const setStatus = (id: number, status: DraftStatus, outcome?: string, record?: Entry["record"]) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status, outcome, record: record ?? e.record } : e)));

  function handOff(entry: Entry) {
    if (entry.proposal?.kind !== "import") return;
    props.onImport(rowsToCsv(entry.proposal.rows), IMPORT_SOURCE);
    setStatus(entry.id, "handed-off");
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (text.length > MAX_MESSAGE) {
      setNote("That is too long to send. For a whole term's roster, use Add students on Roster & teams.");
      return;
    }
    const { snapshot, refs } = buildSnapshot({ course: data.course, roster: data.roster, teams: data.teams });
    const history = historyFor(entries);
    setEntries((prev) => [...prev, { id: nextId.current++, role: "user", text }]);
    setDraft("");
    setNote(null);
    setBusy(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const id = nextId.current++;
    try {
      const reply = await askAssistant({ courseId: data.course.id, message: text, history, snapshot }, controller.signal);
      // Addresses she wrote, plus the ones already on the roster: anything else
      // in a class list is the model's own spelling of somebody's login.
      const known = [text, ...entries.filter((e) => e.role === "user").map((e) => e.text)].concat(
        data.roster.flatMap((s) => (s.email ? [s.email] : [])),
      );
      const unseen = reply.kind === "proposal" && reply.proposal.kind === "import"
        ? emailsNotIn(reply.proposal.rows, known)
        : [];
      const entry: Entry =
        reply.kind === "proposal"
          ? { id, role: "assistant", text: reply.text, proposal: reply.proposal, refs, status: "open", unseen }
          : { id, role: "assistant", text: reply.text };
      setEntries((prev) => [...prev, entry]);
      // A list goes straight to the importer: its preview is the next thing
      // she needs to see, and it writes nothing until she presses its button.
      // Not when it carries an address she never wrote — that waits here, named,
      // because the importer's preview counts rows and would not show it.
      // Nor while the panel is hidden: she has gone to grading or the rubric
      // while it thought, and the list can wait for her on its button.
      if (entry.proposal?.kind === "import" && !unseen.length && !hiddenNow.current) handOff(entry);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setEntries((prev) => [...prev, { id, role: "assistant", text: "", error: String((e as Error)?.message ?? e) }]);
    } finally {
      setBusy(false);
    }
  }

  async function attach(f: File | null | undefined) {
    if (!f) return;
    if (!isSupportedRosterFile(f.name)) {
      setNote(`${f.name} is not a text list — export it as .csv and attach that.`);
      return;
    }
    // Before reading it: a wrong file dropped here can be gigabytes.
    if (f.size > MAX_MESSAGE * 4) {
      setNote(`${f.name} is too long for the assistant. Drop it on Add students, on Roster & teams.`);
      return;
    }
    try {
      const { text } = decodeRosterFile(await f.arrayBuffer());
      if (text.length + draft.length > MAX_MESSAGE) {
        setNote(`${f.name} is too long for the assistant. Drop it on Add students, on Roster & teams.`);
        return;
      }
      setDraft((d) => (d.trim() ? `${d.trimEnd()}\n\n${text}` : `Change the teams to match this list:\n${text}`));
      setNote(`Attached ${f.name}. Edit the request above if you like, then send.`);
      box.current?.focus();
    } catch (e) {
      setNote(`${f.name} could not be read: ${String((e as Error)?.message ?? e)}`);
    }
  }

  return (
    <aside
      className="fv-assist"
      hidden={hidden}
      aria-label="Assistant"
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      <div className="fv-assist-card">
        <div className="fv-as-head">
          <FIcon name="sparkle" size={18} />
          <span className="fv-as-title">Assistant</span>
          {entries.length ? (
            <button type="button" className="fv-btn ghost sm" disabled={busy} onClick={() => setEntries([])}>
              New chat
            </button>
          ) : null}
          <button type="button" className="fv-iconbtn" style={{ width: 30, height: 30 }} aria-label="Close the assistant" onClick={props.onClose}>
            <FIcon name="close" size={16} />
          </button>
        </div>

        <div className="fv-as-log" ref={log} aria-live="polite">
          {!entries.length ? (
            <div className="fv-as-intro">
              Describe a change to the teams — or paste or attach a class list — and I'll draft it. Nothing
              changes until you press Apply on the draft.
              <div className="fv-as-tries">
                {tries(data).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="fv-as-try"
                    onClick={() => {
                      setDraft(t);
                      box.current?.focus();
                    }}
                  >
                    {t.trim()}
                  </button>
                ))}
              </div>
              <p style={{ marginTop: 14 }}>
                Each request sends this course's student names and emails to the AI provider, so it can match
                them.
              </p>
            </div>
          ) : null}

          {entries.map((e) =>
            e.role === "user" ? (
              <div key={e.id} className="fv-as-msg user">
                {e.text}
              </div>
            ) : e.error ? (
              <div key={e.id} className="fv-as-msg error" role="alert">
                {e.error}
              </div>
            ) : (
              <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {e.text ? <div className="fv-as-msg">{e.text}</div> : null}
                {e.proposal?.kind === "seat" && e.refs ? (
                  <SeatingCard
                    courseId={data.course.id}
                    proposal={e.proposal}
                    refs={e.refs}
                    roster={data.roster}
                    teams={data.teams}
                    status={e.status ?? "open"}
                    outcome={e.outcome}
                    record={e.record}
                    onApplied={(outcome, record) => {
                      setStatus(e.id, "applied", outcome, record);
                      props.onChanged();
                    }}
                    onUndone={(outcome) => {
                      setStatus(e.id, "undone", outcome);
                      props.onChanged();
                    }}
                    onRefresh={props.onChanged}
                    onDismiss={() => setStatus(e.id, "dismissed")}
                  />
                ) : null}
                {e.proposal?.kind === "import" ? (
                  <ImportCard
                    proposal={e.proposal}
                    status={e.status ?? "open"}
                    unseen={e.unseen ?? []}
                    onOpen={() => handOff(e)}
                  />
                ) : null}
              </div>
            ),
          )}
          {busy ? <div className="fv-as-working">Working on it</div> : null}
        </div>

        <div className="fv-as-compose">
          <textarea
            ref={box}
            className="fv-ta"
            rows={3}
            placeholder="e.g. Move Ada to Team 3 — or paste a list with team numbers"
            aria-label="Ask the assistant"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch()) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <input
            ref={file}
            type="file"
            accept=".csv,.tsv,.txt"
            style={{ display: "none" }}
            onChange={(e) => {
              void attach(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="fv-as-row">
            <button type="button" className="fv-btn outline sm" disabled={busy} onClick={() => file.current?.click()}>
              <FIcon name="attachFile" size={14} />
              Attach a list
            </button>
            <span className="fv-as-hint">{note ?? (touch() ? "" : "Enter to send · Shift+Enter for a new line")}</span>
            <button
              type="button"
              className="fv-btn primary sm"
              disabled={busy || !draft.trim()}
              onClick={() => void send()}
              aria-label="Send"
            >
              <FIcon name="send" size={15} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
