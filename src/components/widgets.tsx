import { Icon } from "./Icon";
import { AiBadge } from "./badges";

export function StatCard({
  label,
  value,
  icon,
  tint,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  icon: string;
  tint: { fg: string; bg: string };
  sub?: string;
}) {
  return (
    <div className="panel stat-card">
      <div className="stat-card__top">
        <span className="stat-card__icon" style={{ background: tint.bg, color: tint.fg }}>
          <Icon name={icon} size="sm" />
        </span>
        {label}
      </div>
      <div className="stat-card__value">{value}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  );
}

export function SettingRow({
  label,
  desc,
  on,
  aiFlag,
  onToggle,
}: {
  label: string;
  desc?: string;
  on: boolean;
  aiFlag?: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row__body">
        <div className="setting-row__label">
          {label}
          {aiFlag && <AiBadge />}
        </div>
        {desc && <div className="setting-row__desc">{desc}</div>}
      </div>
      <button className={`switch ${on ? "switch--on" : ""}`} aria-pressed={on} onClick={() => onToggle(!on)}>
        <span className="switch__knob" />
      </button>
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="stepper">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div className="stepper__step" key={label}>
            <span className={`stepper__dot ${active ? "stepper__dot--active" : ""} ${done ? "stepper__dot--done" : ""}`}>
              {done ? <Icon name="check" size="sm" /> : i + 1}
            </span>
            <span className={`stepper__label ${active || done ? "" : "stepper__label--inactive"}`}>{label}</span>
            {i < steps.length - 1 && <span className="stepper__line" />}
          </div>
        );
      })}
    </div>
  );
}

export function ProgressBar({ pct, color = "var(--success-fg)" }: { pct: number; color?: string }) {
  return (
    <div className="progress">
      <div className="progress__fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

export function PrepDots({ n, total }: { n: number; total: number }) {
  return (
    <span className="prep-dots">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`prep-dot ${i < n ? "prep-dot--on" : ""}`} />
      ))}
    </span>
  );
}

export function HBar({
  label,
  value,
  max,
  tint = "var(--stage-prep-fg)",
  rightLabel,
}: {
  label: string;
  value: number;
  max: number;
  tint?: string;
  rightLabel?: string;
}) {
  const pct = max === 0 ? 0 : (value / max) * 100;
  return (
    <div className="hbar-row">
      <span>{label}</span>
      <span className="hbar">
        <span className="hbar__fill" style={{ width: `${pct}%`, background: tint }} />
      </span>
      <span style={{ textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {rightLabel ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

export function ScoreButtonsRow({ max, value, onChange }: { max: number; value: number; onChange: (v: number) => void }) {
  return (
    <span className="score-buttons">
      {Array.from({ length: max + 1 }).map((_, i) => (
        <button key={i} className={`score-btn ${i === value ? "score-btn--on" : ""}`} onClick={() => onChange(i)}>
          {i}
        </button>
      ))}
    </span>
  );
}
