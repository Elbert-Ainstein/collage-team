// Material outlined icons only (design-system hard rule — never Lucide/Heroicons).

interface IconProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size = "md", className = "", style }: IconProps) {
  const sizeClass = size === "sm" ? "icon--sm" : size === "lg" ? "icon--lg" : "";
  return (
    <span className={`material-icons-outlined icon ${sizeClass} ${className}`} style={style} aria-hidden>
      {name}
    </span>
  );
}
