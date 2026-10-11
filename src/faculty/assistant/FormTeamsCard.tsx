"use client";

// A whole new set of teams, formed by code from the instructor's rules.
//
// The draft leads with the CHECKS — one line per rule, ticked or not — because
// that is the question she is asking: did every rule hold? The teams themselves
// are a press away; eighty names are not something to read before trusting a
// draft, the checks are. "Try another arrangement" re-forms with a new seed when
// she would rather see a different mix that keeps the same rules.
//
// When the class does not divide by the size she asked for, the odd teams can
// go one smaller or one larger, and that is hers to pick on the draft — not
// something to re-ask the assistant for, and not the optimiser's call.

import { useMemo, useState } from "react";
import type { FormProposal, Leftovers } from "@/assistant/types";
import type { Student, TeamWithMembers } from "@/checkins/types";
import { AppliedCard } from "./AppliedCard";
import { planForm } from "./formPlan";
import { outcomeText } from "./SeatingCard";
import { applyNewSet, applySeating, planSeating, type SeatRecord } from "./seating";
import type { Table } from "./table";
import type { DraftStatus } from "./thread";

interface FormTeamsCardProps {
  courseId: string;
  proposal: FormProposal;
  /** The file attached when this was asked, or null. */
  table: Table | null;
  roster: Student[];
  teams: TeamWithMembers[];
  /** The set `teams` is — what the class goes back to on Undo. */
  currentSetId: string | null;
  /** The database can move the class onto a new set (0045). */
  canMakeSet: boolean;
  status: DraftStatus;
  outcome?: string;
  record?: SeatRecord;
  onApplied: (outcome: string, record: SeatRecord) => void;
  onUndone: (outcome: string) => void;
  onRefresh: () => void;
  onDismiss: () => void;
}

export function FormTeamsCard(props: FormTeamsCardProps): JSX.Element {
  const { proposal, table, roster, teams, status } = props;
  const [seed, setSeed] = useState(1);
  const [leftovers, setLeftovers] = useState<Leftovers>(proposal.leftovers ?? "either");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTeams, setShowTeams] = useState(false);
  /** As on the other drafts: no retry until the class has been re-read. */
  const [failedOn, setFailedOn] = useState<TeamWithMembers[] | null>(null);
  const reloading = failedOn !== null && failedOn === teams;

  // Not while applied: the plan would re-form against the class it just wrote.
  const live = status === "open";
  const plan = useMemo(
    () => (live ? planForm({ ...proposal, leftovers }, table, roster, teams, seed, props.canMakeSet) : null),
    [live, proposal, leftovers, table, roster, teams, seed, props.canMakeSet],
  );
  // Only a size she gave, not a count or a written-out layout, has leftovers.
  const uneven =
    !proposal.layout?.length && !proposal.teamCount && roster.length % Math.max(1, proposal.teamSize) !== 0;
  // Moves within the set in use — only when the teams land there (see formPlan).
  const seating = useMemo(
    () => (plan?.result && !plan.intoNewSet ? planSeating(plan.proposal, plan.refs, roster, teams) : null),
    [plan, roster, teams],
  );
  const nameOf = useMemo(() => new Map(roster.map((s) => [s.id, s.name])), [roster]);

  if (status === "dismissed") return <div className="fv-as-quiet">Draft discarded — nothing was changed.</div>;
  if (status === "applied" || status === "undone") {
    return (
      <AppliedCard
        status={status}
        outcome={props.outcome}
        record={props.record}
        roster={roster}
        teams={teams}
        onUndone={props.onUndone}
        onRefresh={props.onRefresh}
      />
    );
  }
  if (!plan) return <div className="fv-as-quiet">Working out the teams…</div>;

  async function apply() {
    if (!plan?.result) return;
    if (!plan.intoNewSet && !seating) return;
    setBusy(true);
    setError(null);
    try {
      if (plan.intoNewSet) {
        const formed = plan.result.teams;
        const out = await applyNewSet(props.courseId, {
          size: proposal.teamSize,
          previousSetId: props.currentSetId,
          groups: formed.map((t, i) => ({ name: plan.targets[i]?.name ?? `Team ${i + 1}`, studentIds: t.members })),
        });
        props.onApplied(
          `Made ${out.created} teams in a new set, "${out.setName}", and moved the class onto it. ` +
            "The teams you had are kept exactly as they were, with every check-in and hand-in on them — " +
            "rename the new set, or switch back, on Teams.",
          out.record,
        );
        return;
      }
      if (!seating) return;
      const out = await applySeating(props.courseId, seating);
      props.onApplied(outcomeText(out), out.record);
    } catch (e) {
      setFailedOn(teams);
      props.onRefresh();
      setError(`${(e as Error)?.message ?? e} Some of it may have been written — once the class has been re-read, Undo on the applied draft or Apply again.`);
    } finally {
      setBusy(false);
    }
  }

  const result = plan.result;
  const blocked =
    plan.problems.length > 0 || !result || (!plan.intoNewSet && (seating?.problems.length ?? 1) > 0);

  return (
    <div className="fv-as-draft">
      <span className="fv-eyebrow">
        New teams{result ? ` · ${result.teams.length} teams` : ""}
        {table ? ` · from ${table.name}` : ""}
        {plan.intoNewSet ? " · as a new set" : ""}
      </span>

      {plan.problems.length ? (
        <ul className="fv-as-warn">
          {plan.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      {result ? (
        <ul className="fv-as-checks">
          {result.checks.map((c) => (
            <li key={c.text} className={c.ok ? "ok" : "no"}>
              <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.text}
            </li>
          ))}
        </ul>
      ) : null}

      {result && uneven ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <span className="fv-as-quiet">Leftover teams</span>
          {(
            [
              ["smaller", `Some of ${proposal.teamSize - 1}`],
              ["larger", `Some of ${proposal.teamSize + 1}`],
              ["either", "Best fit"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`fv-btn ${leftovers === value ? "outline" : "ghost"} sm`}
              aria-pressed={leftovers === value}
              disabled={busy || (value === "smaller" && proposal.teamSize - 1 < 1)}
              onClick={() => setLeftovers(value)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {proposal.notApplied.length ? (
        <>
          <span className="fv-eyebrow">Not applied</span>
          <ul className="fv-as-warn">
            {proposal.notApplied.map((r) => (
              <li key={r}>{r} — the team-former has no setting for this; check it yourself.</li>
            ))}
          </ul>
        </>
      ) : null}

      {plan.notes.length ? (
        <ul className="fv-as-warn">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {result && showTeams ? (
        <ol className="fv-as-teams">
          {result.teams.map((t, i) => (
            <li key={i}>
              <strong>{plan.targets[i]?.name}</strong>
              {plan.targets[i]?.teamId ? "" : " (new)"} · {/* Full names: "Jon S." could be Jon Smith or Jon Silva. */}
              {t.members.map((id) => nameOf.get(id) ?? "?").join(", ")}
              <div className="fv-as-quiet">
                {[
                  ...Object.entries(t.categories).map(([col, counts]) =>
                    Object.entries(counts)
                      .filter(([, n]) => n > 0)
                      .map(([v, n]) => `${result.labels[col]?.[v] ?? v} ${n}`)
                      .join(" · ") || `no ${col.toLowerCase()} listed`,
                  ),
                  ...Object.entries(t.capped).map(([what, n]) => `${what} ${n}`),
                  ...Object.entries(t.numbers).map(([col, m]) => (m === null ? `${col}: —` : `${col} avg ${Math.round(m)}`)),
                ].join("  |  ")}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="fv-as-quiet" style={{ marginTop: 10 }}>
        {plan.intoNewSet
          ? "Apply makes these a new team set and moves the class onto it. The teams in use now stay exactly as " +
            "they are, with every check-in, hand-in and file on them. Undo moves the class back."
          : "Students move onto the teams already there, in order, and new teams are made for the rest. A team " +
            "left with nobody stays standing. Undo puts everyone back."}
      </div>
      {error ? <div className="fv-as-msg error" style={{ marginTop: 8 }}>{error}</div> : null}
      <div className="fv-as-btns">
        <button type="button" className="fv-btn primary sm" disabled={busy || reloading || blocked} onClick={() => void apply()}>
          {busy ? "Applying…" : reloading ? "Checking the class…" : "Apply"}
        </button>
        {result ? (
          <button type="button" className="fv-btn outline sm" disabled={busy} onClick={() => setShowTeams(!showTeams)}>
            {showTeams ? "Hide the teams" : `Show the ${result.teams.length} teams`}
          </button>
        ) : null}
        {result ? (
          <button type="button" className="fv-btn ghost sm" disabled={busy} onClick={() => setSeed((s) => s + 1)}>
            Try another arrangement
          </button>
        ) : null}
        <button type="button" className="fv-btn ghost sm" disabled={busy} onClick={props.onDismiss}>
          Discard
        </button>
      </div>
    </div>
  );
}
