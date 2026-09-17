"use client";

// One activity's rows on the Review page: who, what they will read, the note
// they will get, and Open into the grading page.
//
// The note is shown whole. On the old all-activities list it was cut to one
// line to keep twelve tables short; on a page for one activity the note IS
// what the instructor came to read, and a TF's "see me about Q3" deserves to
// be seen before it goes out.

import { FAvatar, FIcon } from "./icons";
import type { ReviewRow } from "./reviewModel";

export interface ReviewTableProps {
  rows: ReviewRow[];
  onOpen: (subjectId: string, kind: "individual" | "team") => void;
}

export function ReviewTable({ rows, onOpen }: ReviewTableProps): JSX.Element {
  return (
    <div className="fv-tblwrap">
      <table className="fv-tbl">
        <thead>
          <tr>
            <th>
              <span className="fv-eyebrow">Who</span>
            </th>
            <th>
              <span className="fv-eyebrow">They will see</span>
            </th>
            <th>
              <span className="fv-eyebrow">Note to them</span>
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.result.id} className="fv-trstu">
              <td className="fv-rvcell" style={{ whiteSpace: "nowrap" }}>
                <div className="fv-subject">
                  {r.kind === "team" ? (
                    <FIcon name="groups" size={16} />
                  ) : (
                    <FAvatar name={r.subject.name} tint={r.subject.tint} size={20} />
                  )}
                  <span style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>{r.subject.name}</span>
                  {r.released ? (
                    <span
                      className="fv-badge"
                      style={{ color: "var(--fv-emerald)", borderColor: "var(--fv-emerald)" }}
                      title="This grade is out — the student can see it. Pressing Release again skips this row."
                    >
                      Released
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="fv-rvcell" style={{ whiteSpace: "nowrap" }}>
                <span className="fv-num" style={{ fontSize: "var(--fv-xs)", fontWeight: 600 }}>
                  {r.grade}
                </span>
                {r.pending ? (
                  <span
                    className="fv-sub"
                    style={{ marginLeft: 8, fontSize: "var(--fv-2xs)", color: "var(--fv-amber)" }}
                    title={`Not marked yet: ${r.unmarked.join(", ")}`}
                  >
                    not final
                  </span>
                ) : null}
              </td>
              <td className="fv-rvcell" style={{ width: "100%" }}>
                <span
                  className="fv-sub"
                  style={{
                    display: "block",
                    maxWidth: "64ch",
                    fontSize: "var(--fv-2xs)",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {r.result.feedback?.trim() || "—"}
                </span>
              </td>
              <td className="fv-rvcell" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                  type="button"
                  className="fv-btn ghost sm"
                  onClick={() => onOpen(r.subject.id, r.kind)}
                  title="Open on the grading page"
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
