"use client";

// The TFs tab: a roster of teaching fellows on the left, course-wide
// permissions on the right.
//
// The permissions are course-wide, never per person — they live on the course
// row, so every TF on AP50 gets the same two answers.

import { useEffect, useMemo, useRef, useState } from "react";
import { isSupportedRosterFile, parseRoster } from "@/checkins/rosterImport";
import type { CourseTF } from "@/checkins/types";
import { addTF, addTFs, removeTF, setTFPermissions } from "./facultyData";
import { FAvatar, FIcon } from "./icons";
import { FacultyError, type FacultyData } from "./FacultyApp";

const EMAIL_ONLY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "s.marchetti@fas.harvard.edu" -> "S Marchetti".
 *
 * Someone adding a TF usually has only the address to hand. Storing that as the
 * name puts a login string on the roster row and two meaningless letters in the
 * avatar, so make a readable name out of the local part and tell the user which
 * one we picked.
 */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local
    .split(/[._+-]+/)
    .filter((w) => w.length > 0 && !/^\d+$/.test(w));
  if (!words.length) return email;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/** parseRoster hands back the address itself when a line is nothing else. */
function displayName(name: string, email?: string): string {
  if (EMAIL_ONLY.test(name)) return nameFromEmail(name);
  return name || (email ? nameFromEmail(email) : name);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function TFsScreen(props: {
  data: FacultyData;
  onChanged: () => void;
  onError: (e: unknown) => void;
}): JSX.Element {
  const { data, onChanged, onError } = props;
  const { course, tfs } = data;

  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [email, setEmail] = useState("");
  /** Two clicks to remove: window.confirm is suppressed in this app. */
  const [armed, setArmed] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  // The course row in FacultyData is read once when the app loads, so a
  // permission write is not reflected by the next refresh. Hold what we wrote
  // until the props do change, otherwise the switch appears not to move.
  const [gradeOv, setGradeOv] = useState<boolean | null>(null);
  const [checkinOv, setCheckinOv] = useState<boolean | null>(null);
  useEffect(() => setGradeOv(null), [course.tf_can_grade]);
  useEffect(() => setCheckinOv(null), [course.tf_can_checkin]);

  const grading = gradeOv ?? course.tf_can_grade;
  const checkin = checkinOv ?? course.tf_can_checkin;

  const nextPosition = useMemo(
    () => tfs.reduce((n, t) => Math.max(n, t.position), -1) + 1,
    [tfs],
  );

  const fail = (e: unknown) => {
    setError(String((e as Error)?.message ?? e));
    onError(e);
  };

  /** Re-uploading the same file should not double the roster. */
  const isKnown = (name: string, mail?: string) =>
    tfs.some((t) =>
      mail && t.email ? t.email === mail.toLowerCase() : t.name.toLowerCase() === name.toLowerCase(),
    );

  async function ingest(text: string) {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseRoster(text);
      const people = parsed.students
        .map((s) => ({ name: displayName(s.name, s.email), email: s.email }))
        .filter((p) => !isKnown(p.name, p.email));

      if (people.length) await addTFs(course.id, people, nextPosition);

      const skipped = parsed.students.length - people.length;
      const parts = [
        people.length ? `Added ${plural(people.length, "TF", "TFs")}.` : "No new TFs in that file.",
        skipped ? `${skipped} already on the roster.` : "",
        ...parsed.warnings,
      ].filter(Boolean);
      setNote(parts.join(" "));
      if (people.length) onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function takeFile(f: File | null | undefined) {
    if (!f) return;
    if (!isSupportedRosterFile(f.name)) {
      setNote(`${f.name} is not a text roster — export it as .csv and try again.`);
      return;
    }
    try {
      await ingest(await f.text());
    } catch (e) {
      fail(e);
    }
  }

  async function addOne() {
    const raw = email.trim();
    if (!raw) return;
    setBusy(true);
    setError(null);
    try {
      // Reuse the roster parser so "Ada Lovelace <ada@x.edu>" works here too.
      const one = parseRoster(raw).students[0];
      if (!one) {
        setNote("That did not look like a name or an email address.");
        return;
      }
      const name = displayName(one.name, one.email);
      if (isKnown(name, one.email)) {
        setNote(`${one.email ?? name} is already on the roster.`);
        return;
      }
      await addTF(course.id, { name, email: one.email ?? null }, nextPosition);
      setEmail("");
      setNote(one.email ? `Added ${name} (${one.email}).` : `Added ${name}.`);
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function drop(tf: CourseTF) {
    setArmed(null);
    setBusy(true);
    setError(null);
    try {
      await removeTF(tf.id);
      setNote(`Removed ${tf.name}.`);
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function setPerm(key: "tf_can_grade" | "tf_can_checkin", next: boolean) {
    if (key === "tf_can_grade") setGradeOv(next);
    else setCheckinOv(next);
    setError(null);
    try {
      await setTFPermissions(course.id, { [key]: next });
      onChanged();
    } catch (e) {
      // Put the switch back where it was; the write never landed.
      if (key === "tf_can_grade") setGradeOv(null);
      else setCheckinOv(null);
      fail(e);
    }
  }

  const permRow = (
    label: string,
    description: string,
    on: boolean,
    toggle: () => void,
    first: boolean,
  ) => (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        marginTop: first ? 14 : 13,
        paddingTop: 13,
        borderTop: "1px solid var(--fv-neutral-200)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--fv-sm)", fontWeight: 600 }}>{label}</span>
        <span
          style={{
            display: "block",
            fontSize: "var(--fv-2xs)",
            color: "var(--fv-muted)",
            marginTop: 3,
            lineHeight: 1.5,
          }}
        >
          {description}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`fv-switch${on ? " on" : ""}`}
        onClick={toggle}
      />
    </div>
  );

  return (
    <div className="fv-panel">
      <div className="fv-head">
        <h1 className="fv-h1">TFs</h1>
        <span className="fv-sub">Add your teaching fellows, then set what each one can do.</span>
      </div>

      <FacultyError error={error} onClear={() => setError(null)} />

      <div className="fv-scroll">
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="fv-card" style={{ flex: 1, minWidth: 340, padding: 14 }}>
            <div className="fv-eyebrow" style={{ padding: "0 4px 9px" }}>
              Roster
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {tfs.map((tf, i) => (
                <div
                  key={tf.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "var(--fv-r-md)",
                    borderTop: i === 0 ? "none" : "1px solid var(--fv-neutral-200)",
                  }}
                >
                  <FAvatar name={tf.name} tint={tf.avatar_tint} size={32} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: "var(--fv-sm)",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tf.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "var(--fv-2xs)",
                        color: "var(--fv-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tf.email ?? "No address — they cannot sign in"}
                    </span>
                  </span>

                  {/* Access arrives when they sign up under this address, not
                      when they are added. Without saying so, an instructor has
                      no way to tell why a TF sees nothing. */}
                  {tf.user_id ? null : (
                    <span
                      className="fv-badge"
                      title={
                        tf.email
                          ? `Waiting for ${tf.email} to sign up. Access starts then.`
                          : "Add an address so they can sign in."
                      }
                    >
                      not signed in yet
                    </span>
                  )}

                  {armed === tf.id ? (
                    <button
                      type="button"
                      className="fv-btn sm"
                      style={{ height: 22, padding: "0 8px", color: "var(--fv-destructive)" }}
                      disabled={busy}
                      onClick={() => void drop(tf)}
                      onBlur={() => setArmed(null)}
                    >
                      Remove?
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="fv-iconbtn"
                      style={{ width: 22, height: 22 }}
                      aria-label={`Remove ${tf.name}`}
                      disabled={busy}
                      onClick={() => setArmed(tf.id)}
                    >
                      <FIcon name="close" size={15} />
                    </button>
                  )}
                </div>
              ))}
              {tfs.length === 0 ? (
                <div className="fv-sub" style={{ padding: "10px 12px" }}>
                  No teaching fellows yet.
                </div>
              ) : null}
            </div>

            <input
              ref={file}
              type="file"
              accept=".csv,.tsv,.txt"
              style={{ display: "none" }}
              onChange={(e) => {
                void takeFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`fv-dz sm${over ? " over" : ""}`}
              style={{ width: "100%", marginTop: 12, font: "inherit", color: "inherit" }}
              disabled={busy}
              onClick={() => file.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void takeFile(e.dataTransfer.files?.[0]);
              }}
            >
              <span style={{ color: "var(--fv-muted)" }}>
                <FIcon name="fileUpload" size={24} />
              </span>
              <span style={{ fontSize: "var(--fv-sm)", fontWeight: 600, color: "var(--fv-navy)" }}>
                Upload a TF roster
              </span>
              <span
                style={{
                  fontSize: "var(--fv-xs)",
                  color: "var(--fv-muted)",
                  maxWidth: "40ch",
                  lineHeight: 1.5,
                }}
              >
                Drop a <strong>.csv</strong> of names and emails, or click to choose.
              </span>
            </button>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <span style={{ flex: 1, minWidth: 200 }}>
                <input
                  className="fv-in"
                  placeholder="Add one by email"
                  aria-label="Add one TF by email"
                  value={email}
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addOne();
                  }}
                />
              </span>
              <button
                type="button"
                className="fv-btn outline sm"
                disabled={busy || !email.trim()}
                onClick={() => void addOne()}
              >
                <FIcon name="add" size={15} />
                Add
              </button>
            </div>

            {note ? (
              <div className="fv-sub" style={{ marginTop: 10, lineHeight: 1.5 }}>
                {note}
              </div>
            ) : null}
          </div>

          <div className="fv-card" style={{ width: 320, flex: "none", padding: "16px 18px" }}>
            <div className="fv-eyebrow">Permissions</div>
            <div className="fv-sub" style={{ marginTop: 6, lineHeight: 1.5 }}>
              Applies to every TF on this course.
            </div>

            {permRow(
              "Grading",
              "Can score submissions and release marks.",
              grading,
              () => void setPerm("tf_can_grade", !grading),
              true,
            )}
            {permRow(
              "Check-in",
              "Can run team check-ins and mark them live.",
              checkin,
              () => void setPerm("tf_can_checkin", !checkin),
              false,
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
