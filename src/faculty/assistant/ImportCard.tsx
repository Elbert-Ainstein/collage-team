"use client";

// A class list the assistant rewrote, handed to the Teams screen's importer.
//
// Not applied from here, on purpose. The importer is the one place that knows
// how to add students, fill in addresses, correct names and seat everyone in a
// single press — Kelly's three-column file goes through it every term — and a
// second copy of that path inside a chat panel would be a second set of rules
// to keep in step. So the assistant's job ends at the rows, and the importer's
// own preview is what she checks.
//
// What the importer's preview does NOT show is the rows themselves — it counts
// them. So they are listable here, and an address she never wrote holds the
// hand-off back until she has seen it.

import { useState } from "react";
import type { ImportProposal } from "@/assistant/types";
import type { Table } from "./table";
import type { DraftStatus } from "./thread";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ImportCard(props: {
  proposal: ImportProposal;
  status: DraftStatus;
  /** Addresses in the rows she never wrote. */
  unseen: string[];
  onOpen: () => void;
}): JSX.Element {
  const { rows } = props.proposal;
  const { unseen, status } = props;
  const [listed, setListed] = useState(unseen.length > 0);
  const teams = new Set(rows.flatMap((r) => (r.team == null ? [] : [r.team]))).size;
  const withEmail = rows.filter((r) => r.email).length;
  const odd = new Set(unseen.map((e) => e.toLowerCase()));

  return (
    <div className="fv-as-draft">
      <span className="fv-eyebrow">
        Class list · {plural(rows.length, "student", "students")}
        {teams ? ` · ${plural(teams, "team", "teams")}` : ""}
        {withEmail < rows.length ? ` · ${rows.length - withEmail} without email` : ""}
      </span>

      {unseen.length && status === "open" ? (
        <div className="fv-as-warn" style={{ marginTop: 6 }}>
          {plural(unseen.length, "address", "addresses")} below {unseen.length === 1 ? "is" : "are"} not in
          what you sent: {unseen.join(", ")}. An address is what a student signs in with, so check{" "}
          {unseen.length === 1 ? "it" : "them"} before opening the list in the importer.
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {status === "handed-off"
            ? "Opened in the importer on Roster & teams. Check its preview there — nobody is added or moved " +
              "until you press its button, and \u201CUndo this import\u201D at the top of that page takes it back."
            : "Ready for the importer on Roster & teams."}
        </div>
      )}

      {listed ? (
        <ul>
          {rows.map((r, i) => (
            <li key={`${i}-${r.name}`} className={r.email && odd.has(r.email.toLowerCase()) ? "fv-as-warn" : undefined}>
              {r.name}
              {r.email ? <span className="fv-as-arrow"> · {r.email}</span> : null}
              {r.team != null ? ` · Team ${r.team}` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="fv-as-btns">
        <button type="button" className="fv-btn outline sm" onClick={props.onOpen}>
          {status === "handed-off" ? "Open it again" : unseen.length ? "Open in the importer anyway" : "Open in the importer"}
        </button>
        <button type="button" className="fv-btn ghost sm" onClick={() => setListed(!listed)}>
          {listed ? "Hide the rows" : `Show the ${plural(rows.length, "row", "rows")}`}
        </button>
      </div>
    </div>
  );
}

/**
 * An attached class list going to the importer as it is — no rewriting, so
 * nothing to check here beyond which file it was. The importer's own preview
 * says what it will do.
 */
export function FileImportCard(props: { table: Table; status: DraftStatus; onOpen: () => void }): JSX.Element {
  return (
    <div className="fv-as-draft">
      <span className="fv-eyebrow">
        {props.table.name} · {plural(props.table.rows.length, "row", "rows")}
      </span>
      <div style={{ marginTop: 6 }}>
        {props.status === "handed-off"
          ? "Opened in the importer on Roster & teams. Check its preview there — nobody is added or moved " +
            "until you press its button, and \u201CUndo this import\u201D at the top of that page takes it back."
          : "Ready for the importer on Roster & teams."}
      </div>
      <div className="fv-as-btns">
        <button type="button" className="fv-btn outline sm" onClick={props.onOpen}>
          {props.status === "handed-off" ? "Open it again" : "Open in the importer"}
        </button>
      </div>
    </div>
  );
}
