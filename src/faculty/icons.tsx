// The twelve icons the faculty handoff names, drawn inline on a 24px grid so
// the app fetches nothing at runtime. Same stroked style as the student set.
const P: Record<string, string> = {
  assignment:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  groups:
    '<circle cx="9" cy="8" r="3"/><path d="M3.4 19c0-2.9 2.6-4.8 5.6-4.8s5.6 1.9 5.6 4.8"/><path d="M16.2 5.7a3 3 0 0 1 0 5.7"/><path d="M18.9 19c0-2-.9-3.5-2.4-4.5"/>',
  school:
    '<path d="M12 4L2.5 9 12 14l9.5-5z"/><path d="M6.5 11.3V16c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-4.7"/><path d="M21.5 9v5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.6A2 2 0 0 0 13 4H6a2 2 0 0 0-2 2v7a2 2 0 0 0 1.6 2"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M15 6l3 3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  die: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.6" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.2" fill="currentColor" stroke="none"/>',
  check: '<path d="M4.5 12.5l5 5L20 6.5"/>',
  chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  moreVert:
    '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  fileUpload:
    '<path d="M12 16V4"/><path d="M8 7.5L12 3.5l4 4"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  openInNew:
    '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18.5 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h5.5"/>',
};

export type IconName = keyof typeof P;

export function FIcon({
  name,
  size = 18,
}: {
  name: IconName | string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none" }}
      dangerouslySetInnerHTML={{ __html: P[name] ?? "" }}
    />
  );
}

/** Initials avatar, sized to whatever the design asks for at that spot. */
export function FAvatar({
  name,
  tint,
  size = 22,
}: {
  name: string;
  tint?: string | null;
  size?: number;
}) {
  const letters = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="fv-avatar"
      style={{
        width: size,
        height: size,
        background: tint ?? "var(--fv-navy-700)",
        fontSize: Math.max(9, Math.round(size * 0.42)),
      }}
      aria-hidden="true"
    >
      {letters}
    </span>
  );
}
