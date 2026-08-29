"use client";

// The document attached to an activity, on the activity's own screen.
//
// The bytes have been uploadable since 0012, but only from inside the rubric
// builder — a screen an instructor opens to write marking criteria, not to hand
// out a worksheet. So the handout lived two clicks behind a door labelled
// something else, and most activities never got one. This puts the same slot
// where the brief is written, which is where somebody who has just typed "the
// problem set is attached" is already looking.
//
// The SAME slot, deliberately: attaching here and attaching in the rubric
// builder are one act on one document (see checkins/activityFile.ts). Replacing
// it here replaces the document the criteria are written against, which is
// correct — they are the same paper.
//
// WRITES LAND IMMEDIATELY, not on Save. The editor around this one holds title,
// date and brief until Save, and this control does not follow that rule, on
// purpose: the bytes have to go to the bucket the moment they are chosen, and a
// row that pointed at an upload the instructor then abandoned would be a row
// pointing at litter. Uploading writes activities.files there and then, so what
// the screen shows is what is stored — and pressing Cancel on the editor
// cannot take a file back that the class may already have opened.

import { useRef, useState } from "react";
import { activityFileOf, useActivityFileUrl } from "@/checkins/activityFile";
import type { Activity } from "@/checkins/types";
import { removeActivityFile, uploadActivityFile } from "./facultyData";
import { FIcon } from "./icons";

/** The tiny buttons this component uses — small enough to sit under a paragraph. */
const CHIP = { height: 24, padding: "0 9px", fontSize: "var(--fv-2xs)" } as const;

/**
 * The attachment as the reader meets it: a name they can open, or nothing.
 *
 * Nothing, rather than "no file attached". An activity without a document is
 * the ordinary case and a line announcing its absence would sit under every
 * brief on the course saying the same thing.
 */
export function ActivityFileLine({ activity }: { activity: Activity }) {
  const file = activityFileOf(activity);
  const { url, loading, error } = useActivityFileUrl(file);
  if (!file) return null;

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}
    >
      <span style={{ color: "var(--fv-muted)", display: "flex" }}>
        <FIcon name="attachFile" size={15} />
      </span>
      {url ? (
        <a
          href={url}
          target="_blank"
          // target="_blank" alone hands the new tab a window.opener pointing at
          // this app.
          rel="noopener noreferrer"
          style={{ color: "var(--brief-link)", textDecoration: "underline", textUnderlineOffset: 2 }}
        >
          {file.name}
        </a>
      ) : (
        <span style={{ color: "var(--fv-navy)" }}>{file.name}</span>
      )}
      {file.size ? (
        <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
          {file.size}
        </span>
      ) : null}
      {loading ? <span className="fv-sub">Opening…</span> : null}
      {/* A file with no path is a row written before 0012: it recorded a NAME
          and no bytes, so there is nothing to open and saying why is the only
          way the instructor knows to upload it again. */}
      {!loading && !url ? (
        <span className="fv-sub" style={{ color: "var(--fv-amber)" }}>
          {error ?? "Nothing is stored for this one — attach it again."}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The attach / replace / remove control, for the editor.
 *
 * `onChanged` is the screen's whole-course refresh: the row this writes is the
 * one the reader renders from, so nothing here keeps its own copy of the file.
 */
export function ActivityFileField({
  activity,
  onChanged,
  onError,
}: {
  activity: Activity;
  onChanged: () => void | Promise<void>;
  onError: (e: unknown) => void;
}) {
  const file = activityFileOf(activity);
  const { url } = useActivityFileUrl(file);
  const [busy, setBusy] = useState<"up" | "rm" | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  const take = (picked: File | null | undefined) => {
    if (!picked) return;
    setBusy("up");
    uploadActivityFile(activity, picked)
      .then(() => onChanged())
      .catch(onError)
      .finally(() => setBusy(null));
  };

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      style={{
        marginTop: 10,
        maxWidth: "64ch",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: over ? "8px 10px" : 0,
        border: over ? "1px dashed var(--fv-navy-700)" : "1px dashed transparent",
        borderRadius: "var(--fv-r-md)",
        background: over ? "var(--fv-cream-300)" : "transparent",
      }}
    >
      {/* No `accept`. A handout is a PDF most weeks and a spreadsheet, a slide
          deck or a zip of starter code the other weeks, and an instructor whose
          file is greyed out in the picker has no way to learn why. The bucket's
          own size limit is the one refusal, and it arrives as a sentence. */}
      <input
        ref={picker}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Clear it, or picking the same file twice fires no change event.
          e.target.value = "";
        }}
      />

      {file ? (
        <>
          <span style={{ color: "var(--fv-muted)", display: "flex" }}>
            <FIcon name="attachFile" size={15} />
          </span>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--brief-link)",
                textDecoration: "underline",
                textUnderlineOffset: 2,
                fontSize: "var(--fv-sm)",
              }}
            >
              {file.name}
            </a>
          ) : (
            <span style={{ fontSize: "var(--fv-sm)" }}>{file.name}</span>
          )}
          {file.size ? (
            <span className="fv-sub fv-num" style={{ fontSize: "var(--fv-2xs)" }}>
              {file.size}
            </span>
          ) : null}
          <button
            type="button"
            className="fv-btn ghost sm"
            style={CHIP}
            disabled={busy !== null}
            onClick={() => picker.current?.click()}
          >
            {busy === "up" ? "Uploading…" : "Replace"}
          </button>
          <button
            type="button"
            className="fv-btn ghost sm"
            style={{ ...CHIP, color: "var(--fv-destructive)" }}
            disabled={busy !== null}
            onClick={() => {
              setBusy("rm");
              removeActivityFile(activity)
                .then(() => onChanged())
                .catch(onError)
                .finally(() => setBusy(null));
            }}
          >
            <FIcon name="trash" size={13} />
            {busy === "rm" ? "Removing…" : "Remove"}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="fv-btn ghost sm"
            disabled={busy !== null}
            onClick={() => picker.current?.click()}
          >
            <FIcon name="attachFile" size={13} />
            {busy === "up" ? "Uploading…" : "Attach a file"}
          </button>
          <span className="fv-sub" style={{ fontSize: "var(--fv-2xs)" }}>
            Or drop one here. Students can open it once the activity is visible to them.
          </span>
        </>
      )}
    </div>
  );
}
