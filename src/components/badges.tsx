import { Icon } from "./Icon";

export type BadgeVariant =
  | "success"
  | "warning"
  | "danger"
  | "sky"
  | "lavender"
  | "orange"
  | "navy"
  | "outline";

const BADGE_COLORS: Record<BadgeVariant, { fg: string; bg: string; border?: string }> = {
  success: { fg: "var(--success-fg)", bg: "var(--success-bg)" },
  warning: { fg: "var(--warning-fg)", bg: "var(--warning-bg)" },
  danger: { fg: "var(--danger-fg)", bg: "var(--danger-bg)" },
  sky: { fg: "var(--sky-fg)", bg: "var(--sky-bg)" },
  lavender: { fg: "var(--lavender-fg)", bg: "var(--lavender-bg)" },
  orange: { fg: "var(--stage-collective-fg)", bg: "var(--stage-collective-bg)" },
  navy: { fg: "#fff", bg: "var(--navy)" },
  outline: { fg: "var(--muted)", bg: "#fff", border: "var(--surface-border)" },
};

export function StatusBadge({
  variant,
  children,
  icon,
}: {
  variant: BadgeVariant;
  children: React.ReactNode;
  icon?: string;
}) {
  const c = BADGE_COLORS[variant];
  return (
    <span
      className="badge"
      style={{ color: c.fg, background: c.bg, border: c.border ? `1px solid ${c.border}` : "1px solid transparent" }}
    >
      {icon && <Icon name={icon} size="sm" />}
      {children}
    </span>
  );
}

// AI sparkle marker (✦) — every AI-generated element carries it (§1, §11).
export function AiBadge({ children }: { children?: React.ReactNode }) {
  return (
    <span className="ai-badge">
      <span className="ai-badge__spark">✦</span>
      {children}
    </span>
  );
}
