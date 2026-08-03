// The icon set the student-view handoff names. Outlined, 24px grid, stroked —
// drawn inline so the app fetches nothing at runtime.
const P: Record<string, string> = {
  assignment:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  groups:
    '<circle cx="9" cy="8" r="3"/><path d="M3.4 19c0-2.9 2.6-4.8 5.6-4.8s5.6 1.9 5.6 4.8"/><path d="M16.2 5.7a3 3 0 0 1 0 5.7"/><path d="M18.9 19c0-2-.9-3.5-2.4-4.5"/>',
  chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M4.5 12.5l5 5L20 6.5"/>',
  play: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
  folder: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.2h8a1.5 1.5 0 0 1 1.5 1.5v9.8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.4-4.2 3.1 2.9 3-2.6 4.5 3.9"/>',
  addPhoto:
    '<path d="M20.5 11V17a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2H13"/><circle cx="9" cy="10.5" r="1.5"/><path d="M4.5 17l4-3.8 2.9 2.7 2.7-2.4 3.9 3.5"/><path d="M18 3v6M15 6h6"/>',
  attachFile:
    '<path d="M17.5 8.5l-7.2 7.2a2.6 2.6 0 0 1-3.7-3.7l7.7-7.7a4 4 0 0 1 5.6 5.6l-7.8 7.8a5.4 5.4 0 0 1-7.6-7.6l6.9-6.9"/>',
  moreVert: '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  openInNew: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18.5 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h5.5"/>',
};

export function SIcon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
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
