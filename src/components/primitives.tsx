import { Icon } from "./Icon";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  icon,
  iconRight,
  large,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  icon?: string;
  iconRight?: string;
  large?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn--${variant} ${large ? "btn--lg" : ""}`} {...rest}>
      {icon && <Icon name={icon} size="sm" />}
      {children}
      {iconRight && <Icon name={iconRight} size="sm" />}
    </button>
  );
}

export function Panel({
  children,
  pad = true,
  style,
  className = "",
}: {
  children: React.ReactNode;
  pad?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div className={`panel ${pad ? "panel__pad" : ""} ${className}`} style={style}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

type AlertVariant = "info" | "warning" | "success" | "ai";
const ALERT_ICON: Record<AlertVariant, string> = {
  info: "info",
  warning: "warning",
  success: "check_circle",
  ai: "auto_awesome",
};

export function Alert({
  variant,
  children,
  icon,
}: {
  variant: AlertVariant;
  children: React.ReactNode;
  icon?: string;
}) {
  return (
    <div className={`alert alert--${variant}`}>
      <Icon name={icon ?? ALERT_ICON[variant]} size="sm" className="alert__icon" />
      <div>{children}</div>
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--muted)",
        margin: "4px 0 12px",
      }}
    >
      {children}
    </div>
  );
}
