"use client";

// Student view — the Audio card on a team activity (handoff §3), wired to real
// storage.
//
// Everything here hangs off ONE row: the team's check-in result. That is the
// row the storage layer authorises against (src/checkins/audio.ts,
// supabase/migrations/0013_recordings.sql), so with no such row there is
// nothing for audio to attach to — the card says which of the three reasons
// applies rather than offering a Record button that could only fail.
//
// The microphone is asked for on the first press of Record, never on mount: a
// student opening an activity to read the brief should not set the tab's
// recording light going.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteRecording,
  keepRecording,
  listRecordings,
  recordingUrl,
  uploadRecording,
  type Recording,
} from "@/checkins/audio";
import { SIcon } from "./icons";

// ----------------------------------------------------------------- helpers

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** "3:07", and "1:02:14" once a discussion runs past the hour. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "Aug 4, 2:14pm". Fixed locale, so a reload never renames a take. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "time unknown";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${day}, ${h}:${String(d.getMinutes()).padStart(2, "0")}${h24 >= 12 ? "pm" : "am"}`;
}

const NO_RECORDER =
  "This browser can't record audio. Chrome, Edge, Firefox and recent Safari can — " +
  "and the page has to be on an https address, because browsers refuse the " +
  "microphone on plain http.";

/**
 * What getUserMedia refused with, in words a student can act on.
 *
 * The three that actually happen in a classroom: the permission prompt was
 * dismissed, the laptop has no input selected, and something else is already
 * holding the microphone — a video call, or this same activity open in a
 * second tab.
 */
function micTrouble(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return (
        "The browser blocked the microphone. Click the padlock in the address bar, " +
        "allow the microphone for this site, then press Record again."
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return (
        "No microphone reached the browser. Plug one in, or pick an input in your " +
        "system sound settings, then press Record again."
      );
    case "NotReadableError":
      return (
        "Something else is holding the microphone — a video call, or this page open " +
        "in another tab. Close it and press Record again."
      );
    case "AbortError":
      return "The microphone stopped responding before recording began. Press Record again.";
    default:
      return message(e, "The microphone could not be started. Press Record again.");
  }
}

/** A recorder that died mid-take: unplugged device, revoked permission. */
function recorderTrouble(event: Event): string {
  const raw: unknown = (event as { error?: unknown }).error;
  const detail = raw instanceof DOMException || raw instanceof Error ? ` (${raw.message})` : "";
  return (
    `Recording stopped on its own${detail}. The microphone was unplugged, muted, or ` +
    "its permission was withdrawn. Whatever was captured up to that point is saved below — " +
    "check it before recording again."
  );
}

function releaseStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function without(map: Record<string, string>, key: string): Record<string, string> {
  const next = { ...map };
  delete next[key];
  return next;
}

// --------------------------------------------------------------- component

type Phase = "idle" | "starting" | "recording" | "saving";

/** A take that was recorded but not stored. Held so it can be retried. */
interface Pending {
  blob: Blob;
  durationMs: number;
  error: string;
}

/**
 * Takes that have been captured but not yet stored, keyed by result row.
 *
 * Module scope, so it survives this component unmounting — which ordinary
 * navigation does. Clicking the Individual tab, "Open team work", or a sidebar
 * item unmounts the card, and before this a take in progress was thrown away
 * and a failed upload was dropped without a word. Neither is recoverable once
 * gone: the microphone does not remember. It is not persisted to disk — a blob
 * in localStorage is a different problem — so a reload still costs the take,
 * which is what the beforeunload guard is for.
 */
const unsaved = new Map<string, Pending>();


interface Take {
  recording: Recording;
  /** 1-based in the order the team recorded them — what "trial 2" means. */
  n: number;
}

export function Recorder({
  resultId,
  unavailable,
}: {
  /** The team check-in result the audio hangs off, or null when there is none. */
  resultId: string | null;
  /** Why there is no such row, in a sentence, when there is not. */
  unavailable: string | null;
}) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [armedDiscard, setArmedDiscard] = useState(false);

  const [urls, setUrls] = useState<Record<string, string>>({});
  const [urlBusy, setUrlBusy] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<Record<string, string>>({});

  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  /** Which take is being kept/unkept, so only its own button says so. */
  const [keeping, setKeeping] = useState<string | null>(null);
  const [keepError, setKeepError] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  // Async work started before an unmount must not call setState after it, and
  // a take finishing after the student left has nobody to report to.
  const liveRef = useRef(true);

  // On unmount the microphone is released immediately, but the take is KEPT.
  // The handlers stay attached so `onstop` still fires and hands the finished
  // blob to `unsaved`; nulling them was throwing away everything captured so
  // far, and one click on a sidebar item was enough to do it.
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          // Already stopping; the tracks below are what frees the microphone.
        }
      }
      releaseStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  // Adopt anything left behind by an earlier visit to this card, so a take that
  // survived a screen change is offered back rather than sitting in memory
  // where nobody can reach it.
  useEffect(() => {
    if (!resultId) return;
    const left = unsaved.get(resultId);
    if (left) {
      setPending(left);
      setPhase("idle");
    }
  }, [resultId]);

  useEffect(() => {
    if (!resultId) {
      setRecordings([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setListError(null);
    listRecordings([resultId])
      .then((rows) => {
        if (!cancelled) setRecordings(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setListError(
            message(e, "Could not load this team's recordings.") +
              " Reload the page to try again — nothing has been lost.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resultId]);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = window.setInterval(() => setElapsed(Date.now() - startedAtRef.current), 250);
    return () => window.clearInterval(t);
  }, [phase]);

  // A take in progress, or one waiting to be retried, is unsaved work.
  useEffect(() => {
    if (phase === "idle" && !pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase, pending]);

  const save = useCallback(
    async (blob: Blob, durationMs: number) => {
      if (!resultId) return;
      setPhase("saving");
      try {
        const row = await uploadRecording(resultId, blob, durationMs);
        unsaved.delete(resultId);
        if (!liveRef.current) return;
        setPending(null);
        setArmedDiscard(false);
        setRecordings((prev) => [...prev, row]);
        setPhase("idle");
      } catch (e) {
        const failed = {
          blob,
          durationMs,
          error: message(e, "The recording could not be saved."),
        };
        // Stash FIRST, and unconditionally. The old guard returned early when
        // the card had unmounted — so starting the upload and then clicking
        // through to write the answer while it ran meant a failure dropped the
        // recording with nobody told. Now it is waiting when they come back.
        unsaved.set(resultId, failed);
        if (!liveRef.current) return;
        setPending(failed);
        setPhase("idle");
      }
    },
    [resultId],
  );

  async function start() {
    if (!resultId || phase !== "idle" || pending) return;
    setRecordError(null);

    if (typeof MediaRecorder === "undefined" || typeof navigator.mediaDevices === "undefined") {
      setRecordError(NO_RECORDER);
      return;
    }

    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setPhase("idle");
      setRecordError(micTrouble(e));
      return;
    }
    if (!liveRef.current) {
      releaseStream(stream);
      return;
    }

    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream);
    } catch (e) {
      releaseStream(stream);
      setPhase("idle");
      setRecordError(
        message(e, "This browser handed over the microphone but refused to record from it.") +
          " Chrome or Firefox will.",
      );
      return;
    }

    const chunks: Blob[] = [];
    rec.ondataavailable = (ev: BlobEvent) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    rec.onerror = (ev: Event) => {
      if (liveRef.current) setRecordError(recorderTrouble(ev));
    };
    rec.onstop = () => {
      releaseStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      if (!liveRef.current) return;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (blob.size === 0) {
        setPhase("idle");
        setRecordError(
          "That take came back with no audio at all — the microphone was muted, or the " +
            "tab lost it partway through. Check the mute switch and record it again.",
        );
        return;
      }
      void save(blob, Date.now() - startedAtRef.current);
    };

    streamRef.current = stream;
    recorderRef.current = rec;
    startedAtRef.current = Date.now();
    setElapsed(0);
    try {
      // A timeslice, so a long discussion arrives in pieces instead of as one
      // buffer the tab has to hold whole and hand over at the end.
      rec.start(1000);
    } catch (e) {
      releaseStream(stream);
      streamRef.current = null;
      recorderRef.current = null;
      setPhase("idle");
      setRecordError(message(e, "The recorder would not start. Press Record again."));
      return;
    }
    setPhase("recording");
  }

  function stop() {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    // The upload runs from onstop, which is also the path a recorder that died
    // on its own takes — one place where a take becomes a stored recording.
    rec.stop();
  }

  async function play(r: Recording) {
    if (urls[r.id] || urlBusy) return;
    setUrlBusy(r.id);
    setUrlError((prev) => without(prev, r.id));
    try {
      const url = await recordingUrl(r.path);
      if (liveRef.current) setUrls((prev) => ({ ...prev, [r.id]: url }));
    } catch (e) {
      if (liveRef.current) {
        setUrlError((prev) => ({
          ...prev,
          [r.id]: message(e, "That recording could not be opened for playback."),
        }));
      }
    } finally {
      if (liveRef.current) setUrlBusy(null);
    }
  }

  /**
   * Keep a take in Team resources, or stop keeping it.
   *
   * The take is not copied anywhere — it is already the team's, filed under
   * this activity. Keeping it is a flag, so unkeeping cannot lose the audio and
   * the two places can never disagree about what it is.
   */
  async function keep(r: Recording, n: number) {
    const next = !r.in_resources;
    setKeeping(r.id);
    setKeepError((prev) => without(prev, r.id));
    // Optimistic: it is a toggle, and the list it affects is on another screen.
    setRecordings((prev) =>
      prev.map((x) =>
        x.id === r.id
          ? { ...x, in_resources: next, title: next ? x.title ?? `Take ${n}` : x.title }
          : x,
      ),
    );
    try {
      await keepRecording(r.id, next, next ? r.title ?? `Take ${n}` : undefined);
    } catch (e) {
      if (!liveRef.current) return;
      setRecordings((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, in_resources: r.in_resources } : x)),
      );
      setKeepError((prev) => ({
        ...prev,
        [r.id]: message(e, "That didn't save."),
      }));
    } finally {
      if (liveRef.current) setKeeping(null);
    }
  }

  async function remove(r: Recording) {
    setDeleting(r.id);
    setDeleteError((prev) => without(prev, r.id));
    try {
      await deleteRecording(r.id);
      if (!liveRef.current) return;
      setRecordings((prev) => prev.filter((x) => x.id !== r.id));
      setUrls((prev) => without(prev, r.id));
      setArmedDelete(null);
    } catch (e) {
      if (liveRef.current) {
        setDeleteError((prev) => ({
          ...prev,
          [r.id]: message(e, "That recording could not be deleted."),
        }));
      }
    } finally {
      if (liveRef.current) setDeleting(null);
    }
  }

  // Numbered in the order the team recorded them, listed the other way up: the
  // take everyone wants is the one they just made.
  const takes = useMemo<Take[]>(() => {
    const asc = [...recordings].sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return asc.map((recording, i) => ({ recording, n: i + 1 })).reverse();
  }, [recordings]);

  const blocked = resultId === null;
  // Reached only when the caller had no reason to give but still passed no row —
  // the row is created on demand now, so this is a write that did not land
  // rather than a state the student put themselves in.
  const reason =
    unavailable ??
    "Setting this activity up for recording didn't finish. Reload the page and try again.";

  return (
    <div className="sv-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="sv-eyebrow" style={{ flex: 1 }}>
          Audio
        </div>
        {!blocked && takes.length > 0 ? (
          <span className="sv-badge secondary">
            {takes.length} {takes.length === 1 ? "recording" : "recordings"}
          </span>
        ) : null}
        {phase === "recording" ? (
          <span className="sv-badge warning" role="status">
            <span
              aria-hidden="true"
              style={{ width: 7, height: 7, borderRadius: 999, background: "var(--orange-500)" }}
            />
            Recording
          </span>
        ) : null}
      </div>

      {blocked ? (
        <p
          style={{
            margin: "10px 0 0",
            fontSize: "var(--text-sm)",
            lineHeight: 1.6,
            color: "var(--muted-foreground)",
            maxWidth: "62ch",
          }}
        >
          {reason}
        </p>
      ) : (
        <>
          {/* ------------------------------------------------------ controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            {phase === "recording" ? (
              <>
                <button type="button" className="sv-btn primary" onClick={stop}>
                  <span
                    aria-hidden="true"
                    style={{ width: 10, height: 10, borderRadius: 2, background: "currentColor" }}
                  />
                  Stop and save
                </button>
                <span
                  className="sv-num"
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: "var(--text-xl)",
                    fontWeight: "var(--weight-bold)",
                    letterSpacing: "var(--tracking-tight)",
                  }}
                >
                  {clock(elapsed)}
                </span>
                <span className="sv-sub" style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
                  Leaving this page stops the microphone, but the take is kept — come back and
                  it will be here to save. Closing the tab does lose it.
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="sv-btn primary"
                  onClick={() => void start()}
                  disabled={phase !== "idle" || pending !== null}
                  title={
                    pending
                      ? "Save or discard the take below first."
                      : phase === "starting"
                        ? "Waiting for the microphone"
                        : phase === "saving"
                          ? "A recording is still uploading"
                          : "Record your team's discussion"
                  }
                >
                  <SIcon name="mic" size={15} />
                  {phase === "starting"
                    ? "Waiting for the microphone…"
                    : phase === "saving"
                      ? "Saving…"
                      : takes.length
                        ? "Record another take"
                        : "Record the discussion"}
                </button>
                <span className="sv-sub" style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
                  {phase === "saving"
                    ? "Uploading the take you just recorded. Don't leave this page until it appears below."
                    : "Your browser asks for the microphone the first time. Everyone on your team can play, and delete, whatever you save."}
                </span>
              </>
            )}
          </div>

          {phase === "saving" ? (
            <div
              role="status"
              style={{
                marginTop: 10,
                padding: "10px 12px",
                border: "1px solid var(--cream-500)",
                background: "var(--cream-300)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-xs)",
                color: "var(--navy)",
              }}
            >
              Saving the recording…
            </div>
          ) : null}

          {recordError ? (
            <div
              role="alert"
              style={{
                marginTop: 10,
                fontSize: "var(--text-xs)",
                color: "var(--amber-700)",
                lineHeight: 1.5,
                maxWidth: "68ch",
              }}
            >
              {recordError}
            </div>
          ) : null}

          {/* --------------------------------------------- a take not stored */}
          {pending ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                border: "1px solid var(--cream-500)",
                background: "var(--cream-300)",
                borderRadius: "var(--radius-lg)",
                padding: 14,
              }}
            >
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
                A {clock(pending.durationMs)} take is not saved yet
              </div>
              <p className="sv-sub" style={{ margin: "6px 0 0", lineHeight: 1.6, maxWidth: "62ch" }}>
                {pending.error} It is still on this page, so Try again will send the same
                recording. Leaving the page loses it.
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginTop: 12,
                }}
              >
                <button
                  type="button"
                  className="sv-btn primary sm"
                  onClick={() => void save(pending.blob, pending.durationMs)}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className="sv-btn outline sm"
                  style={armedDiscard ? { color: "var(--amber-700)" } : undefined}
                  onClick={() => {
                    if (!armedDiscard) {
                      setArmedDiscard(true);
                      return;
                    }
                    setPending(null);
                    setArmedDiscard(false);
                  }}
                  onBlur={() => setArmedDiscard(false)}
                >
                  {armedDiscard ? "Throw the take away?" : "Discard it"}
                </button>
                {armedDiscard ? (
                  <span
                    className="sv-sub"
                    style={{ color: "var(--amber-700)", maxWidth: "40ch", lineHeight: 1.5 }}
                  >
                    The audio was never stored, so discarding it leaves nothing to recover. This
                    cannot be undone.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ------------------------------------------------------- the list */}
          <div className="sv-rule" style={{ margin: "16px 0 12px" }} />

          {listError ? (
            <div
              role="alert"
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--amber-700)",
                lineHeight: 1.5,
                maxWidth: "68ch",
              }}
            >
              {listError}
            </div>
          ) : loading ? (
            <div className="sv-sub">Loading your team&rsquo;s recordings…</div>
          ) : takes.length === 0 ? (
            <div className="sv-sub" style={{ lineHeight: 1.6, maxWidth: "62ch" }}>
              No recordings yet. Press Record when the discussion starts — you can make as many
              takes as you like, and they all stay here.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {takes.map(({ recording, n }) => {
                const url = urls[recording.id];
                const armed = armedDelete === recording.id;
                const busy = deleting === recording.id;
                return (
                  <li
                    key={recording.id}
                    style={{
                      border: "1px solid var(--neutral-200)",
                      background: "var(--cream-300)",
                      borderRadius: "var(--radius-md)",
                      padding: "10px 12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ color: "var(--muted-foreground)", display: "flex" }}>
                        <SIcon name="mic" size={16} />
                      </span>
                      <span
                        style={{
                          fontSize: "var(--text-sm)",
                          fontWeight: "var(--weight-semibold)",
                        }}
                      >
                        Take {n}
                      </span>
                      <span className="sv-sub sv-num">
                        {recording.duration_ms === null
                          ? "length unknown"
                          : clock(recording.duration_ms)}
                      </span>
                      <span className="sv-sub">· {stamp(recording.created_at)}</span>
                      <span style={{ flex: 1 }} />
                      {url ? null : (
                        <button
                          type="button"
                          className="sv-btn outline sm"
                          onClick={() => void play(recording)}
                          disabled={urlBusy !== null}
                          title={`Play take ${n}`}
                        >
                          <SIcon name="play" size={14} />
                          {urlBusy === recording.id ? "Opening…" : "Play"}
                        </button>
                      )}
                      {/* Kept takes show up in Team resources beside the
                          team's photos — same kind of thing, one place to look
                          for it. A flag rather than a copy, so unkeeping cannot
                          lose the audio. */}
                      <button
                        type="button"
                        className={recording.in_resources ? "sv-btn sm" : "sv-btn outline sm"}
                        aria-pressed={Boolean(recording.in_resources)}
                        disabled={keeping === recording.id || busy}
                        onClick={() => void keep(recording, n)}
                        title={
                          recording.in_resources
                            ? "Remove this take from Team resources. The audio stays here."
                            : "Keep this take in Team resources, beside your team's photos"
                        }
                      >
                        <SIcon name={recording.in_resources ? "check" : "folder"} size={14} />
                        {keeping === recording.id
                          ? "Saving…"
                          : recording.in_resources
                            ? "In resources"
                            : "Add to resources"}
                      </button>
                      <button
                        type="button"
                        className="sv-btn link sm"
                        style={{ color: armed ? "var(--amber-700)" : undefined }}
                        onClick={() => {
                          if (!armed) {
                            setArmedDelete(recording.id);
                            return;
                          }
                          void remove(recording);
                        }}
                        onBlur={() => setArmedDelete((cur) => (cur === recording.id ? null : cur))}
                        disabled={busy}
                        title={
                          armed
                            ? "Deletes the audio for the whole team. This cannot be undone."
                            : `Delete take ${n}`
                        }
                      >
                        {busy ? "Deleting…" : armed ? `Delete take ${n} for everyone?` : "Delete"}
                      </button>
                    </div>

                    {armed && !busy ? (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: "var(--text-2xs)",
                          color: "var(--amber-700)",
                          lineHeight: 1.5,
                          maxWidth: "62ch",
                        }}
                      >
                        The audio and its entry go for everyone on your team, and for your
                        instructor. This cannot be undone.
                      </div>
                    ) : null}

                    {url ? (
                      <audio
                        controls
                        autoPlay
                        src={url}
                        aria-label={`Take ${n}, recorded ${stamp(recording.created_at)}`}
                        onError={() => {
                          setUrls((prev) => without(prev, recording.id));
                          setUrlError((prev) => ({
                            ...prev,
                            [recording.id]:
                              "Playback stopped. The link this take was opened with lasts an hour, " +
                              "and connections drop — press Play to open it again.",
                          }));
                        }}
                        style={{ width: "100%", marginTop: 10, display: "block" }}
                      />
                    ) : null}

                    {urlError[recording.id] ? (
                      <div
                        role="alert"
                        style={{
                          marginTop: 8,
                          fontSize: "var(--text-xs)",
                          color: "var(--amber-700)",
                          lineHeight: 1.5,
                          maxWidth: "62ch",
                        }}
                      >
                        {urlError[recording.id]}
                      </div>
                    ) : null}

                    {deleteError[recording.id] ? (
                      <div
                        role="alert"
                        style={{
                          marginTop: 8,
                          fontSize: "var(--text-xs)",
                          color: "var(--amber-700)",
                          lineHeight: 1.5,
                          maxWidth: "62ch",
                        }}
                      >
                        {deleteError[recording.id]}
                      </div>
                    ) : null}

                    {keepError[recording.id] ? (
                      <div
                        role="alert"
                        style={{
                          marginTop: 8,
                          fontSize: "var(--text-xs)",
                          color: "var(--amber-700)",
                          lineHeight: 1.5,
                          maxWidth: "62ch",
                        }}
                      >
                        {keepError[recording.id]}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
