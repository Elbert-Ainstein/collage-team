import { Icon } from "./Icon";
import { Panel } from "./primitives";

export interface ReceiptRow {
  label: string;
  value: React.ReactNode;
}

export function ConfirmationCard({
  title,
  subtitle,
  receipt,
  children,
  actions,
  icon = "check",
}: {
  title: string;
  subtitle?: string;
  receipt?: ReceiptRow[];
  children?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: string;
}) {
  return (
    <Panel className="confirm-card">
      <div className="confirm-card__ring">
        <Icon name={icon} size="lg" />
      </div>
      <div className="confirm-card__title">{title}</div>
      {subtitle && <div className="confirm-card__sub">{subtitle}</div>}
      {receipt && (
        <div className="receipt">
          {receipt.map((r) => (
            <div className="receipt__row" key={r.label}>
              <span className="receipt__label">{r.label}</span>
              <span className="receipt__value">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      {children}
      {actions && <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>{actions}</div>}
    </Panel>
  );
}
