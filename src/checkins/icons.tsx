// Inline SVG icon set, ported from the Collage-Team prototype.
const PATHS: Record<string, string> = {
  groups:
    '<circle cx="9" cy="8" r="3.1"/><path d="M3.2 19c0-3 2.7-5 5.8-5s5.8 2 5.8 5"/><path d="M16 5.6a3 3 0 0 1 0 5.8"/><path d="M18.8 19c0-2-1-3.6-2.6-4.6"/>',
  table:
    '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9.5h18M3 14.5h18M9 4.5v15"/>',
  // Teams: two grouped pairs, distinct from the roster's single-person icon.
  teams:
    '<circle cx="7.5" cy="7.5" r="2.4"/><circle cx="16.5" cy="7.5" r="2.4"/><path d="M3.4 17c0-2.3 1.9-3.7 4.1-3.7s4.1 1.4 4.1 3.7"/><path d="M12.4 17c0-2.3 1.9-3.7 4.1-3.7s4.1 1.4 4.1 3.7"/>',
  clipboard:
    '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9 4.5V3.5h6v1"/><path d="M8.5 9.5h7M8.5 13h7M8.5 16.5h4"/>',
  chevdown: '<path d="M6 9.5l6 6 6-6"/>',
  chevright: '<path d="M9.5 6l6 6-6 6"/>',
  moon: '<path d="M20 14.4A8 8 0 1 1 9.6 4a6.5 6.5 0 0 0 10.4 10.4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4L19 19M19 5l-1.6 1.6M6.6 17.4L5 19"/>',
  upload:
    '<path d="M12 15.5V4M8 8l4-4 4 4"/><path d="M4 15v3.2A1.8 1.8 0 0 0 5.8 20h12.4a1.8 1.8 0 0 0 1.8-1.8V15"/>',
  check: '<path d="M4.5 12.5l5 5L20 6.5"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? "" }}
    />
  );
}
