// Material outlined icons only (design-system hard rule — never Lucide/Heroicons).

interface IconProps {
  name: string;
  /** Preset (sm/md/lg) or an exact pixel size — the redesign uses precise px sizes. */
  size?: "sm" | "md" | "lg" | number;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size = "md", className = "", style }: IconProps) {
  const numeric = typeof size === "number";
  const sizeClass = numeric ? "" : size === "sm" ? "icon--sm" : size === "lg" ? "icon--lg" : "";
  const mergedStyle: React.CSSProperties | undefined = numeric
    ? { fontSize: size, width: size, height: size, overflow: "hidden", display: "inline-block", ...style }
    : style;
  return (
    <span className={`material-symbols-outlined icon ${sizeClass} ${className}`} style={mergedStyle} aria-hidden>
      {name}
    </span>
  );
}
