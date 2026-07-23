"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Icon, PageHeader, Panel, StatCard, Stepper, StatusBadge } from "@/components";
import {
  applyImport,
  parseAndValidate,
  ROSTER_FIELDS,
  sampleCsvRows,
  SAMPLE_CSV_HEADERS,
  stats,
  type FieldKey,
} from "@/services/rosterService";

const STEPS = ["Upload", "Map columns", "Validate", "Confirm"];

export function RosterImport() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [result, setResult] = useState<{ members: number; teams: number } | null>(null);

  const parsed = useMemo(() => (rows.length ? parseAndValidate(rows, mapping) : []), [rows, mapping]);
  const s = useMemo(() => stats(parsed), [parsed]);

  function loadSample() {
    setRows(sampleCsvRows());
    setHeaders(SAMPLE_CSV_HEADERS);
    // Guess the mapping from header names.
    setMapping(SAMPLE_CSV_HEADERS.map((h) => (ROSTER_FIELDS.some((f) => f.key === h) ? (h as FieldKey) : "ignore")));
    setStep(1);
  }

  function confirm() {
    setResult(applyImport(parsed));
    setStep(3);
  }

  const continueLabel = step === 2 ? "Confirm import" : "Continue";
  const canContinue = step === 0 ? rows.length > 0 : true;

  return (
    <>
      <PageHeader
        title="Roster & import"
        subtitle="Bring your class roster in from a CSV or spreadsheet."
        actions={
          <>
            {step > 0 && step < 3 && (
              <Button variant="secondary" icon="arrow_back" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {step < 2 && (
              <Button variant="primary" iconRight="arrow_forward" disabled={!canContinue} onClick={() => setStep(step + 1)}>
                {continueLabel}
              </Button>
            )}
            {step === 2 && (
              <Button variant="primary" icon="check" onClick={confirm}>
                Confirm import
              </Button>
            )}
          </>
        }
      />

      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <Panel>
          <div className="dropzone" style={{ padding: 40 }}>
            <Icon name="upload_file" size="lg" />
            <div style={{ margin: "10px 0" }}>
              Drop a CSV or Excel roster here — supports .csv, .xlsx · first row should be column headers.
            </div>
            <Button variant="secondary" icon="description" onClick={loadSample}>
              Load sample roster
            </Button>
          </div>
          <div style={{ marginTop: 14, fontSize: "var(--text-xs)", color: "var(--muted)" }}>
            Fields we read: name, email, student ID, team, section, role ·{" "}
            <a style={{ color: "var(--navy)", fontWeight: 600, cursor: "pointer" }} onClick={loadSample}>
              Download sample template
            </a>
          </div>
        </Panel>
      )}

      {step === 1 && (
        <Panel>
          <div style={{ fontWeight: 600, color: "var(--navy)", marginBottom: 12 }}>Map your columns to platform fields</div>
          {headers.map((h, i) => (
            <div key={h} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--surface-border)" }}>
              <code style={{ fontFamily: "var(--font-mono)", background: "#f3efe4", padding: "4px 8px", borderRadius: 6, fontSize: "var(--text-xs)" }}>
                {h}
              </code>
              <Icon name="arrow_forward" size="sm" style={{ color: "var(--muted-2)" }} />
              <select
                className="text-input"
                style={{ maxWidth: 220 }}
                value={mapping[i] ?? "ignore"}
                onChange={(e) => {
                  const next = mapping.slice();
                  next[i] = e.target.value as FieldKey;
                  setMapping(next);
                }}
              >
                {ROSTER_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </Panel>
      )}

      {step === 2 && (
        <>
          <div className="stat-grid">
            <StatCard label="Valid" icon="check_circle" tint={{ fg: "var(--success-fg)", bg: "var(--success-bg)" }} value={s.valid} />
            <StatCard label="Need attention" icon="warning" tint={{ fg: "var(--warning-fg)", bg: "var(--warning-bg)" }} value={s.needAttention} />
            <StatCard label="Teams detected" icon="groups" tint={{ fg: "var(--stage-discussion-fg)", bg: "var(--stage-discussion-bg)" }} value={s.teams} />
            <StatCard label="Missing email" icon="mail" tint={{ fg: "var(--danger-fg)", bg: "var(--danger-bg)" }} value={s.missingEmail} />
          </div>
          {s.needAttention > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Alert variant="warning">Fix the flagged rows, or import now and resolve them later.</Alert>
            </div>
          )}
          <Panel pad={false} style={{ padding: 8, maxHeight: 380, overflow: "auto" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Team</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p) => (
                  <tr key={p.index}>
                    <td>{p.first} {p.last}</td>
                    <td>{p.email || <span style={{ color: "var(--danger-fg)" }}>—</span>}</td>
                    <td>{p.team}</td>
                    <td>
                      {p.warnings.length === 0 ? (
                        <StatusBadge variant="success">OK</StatusBadge>
                      ) : (
                        p.warnings.map((w) => (
                          <StatusBadge key={w} variant={w === "No email" ? "danger" : "warning"}>
                            {w}
                          </StatusBadge>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}

      {step === 3 && result && (
        <Panel style={{ textAlign: "center", padding: 32, maxWidth: 520, margin: "0 auto" }}>
          <div className="confirm-card__ring">
            <Icon name="check" size="lg" />
          </div>
          <div className="confirm-card__title">Roster imported</div>
          <div className="confirm-card__sub">
            {result.members} students across {result.teams} teams. Historical team records were preserved.
          </div>
          <div style={{ marginTop: 18 }}>
            <Button variant="primary" iconRight="arrow_forward" onClick={() => router.push("/i/roster?tab=teams")}>
              Manage teams
            </Button>
          </div>
        </Panel>
      )}
    </>
  );
}
