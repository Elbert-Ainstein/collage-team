/**
 * The mark: three teammates and a check.
 *
 * This team, checked in — which is what the product does. Deliberately not the
 * plain checkmark-in-a-rounded-square every task app uses: that reads as "a
 * thing got done", and what happens here is that a TEAM was marked, in a room,
 * in a session.
 *
 * Kept in sync BY HAND with app/icon.svg, which is the favicon and cannot be a
 * component — Next.js reads that path as a static file. Two copies of eleven
 * lines is the cheaper problem than a build step to generate one from the
 * other; if the mark changes, change both.
 *
 * Inline SVG rather than an <img>: it needs no network request, it inherits
 * nothing it should not, and the app's CSP blocks external hosts anyway.
 */
export function Logo({ size = 32 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Collage-Team"
      style={{ display: "block", flex: "none" }}
    >
      <rect width="32" height="32" rx="7.5" fill="#002341" />
      <circle cx="11.4" cy="11.4" r="3.4" fill="#FFFCF2" opacity=".6" />
      <circle cx="20.6" cy="11.4" r="3.4" fill="#FFFCF2" opacity=".6" />
      <circle cx="11.4" cy="20.6" r="3.4" fill="#FFFCF2" opacity=".6" />
      <path
        d="M17.4 20.9 L19.8 23.3 L24.5 17.6"
        fill="none"
        stroke="#EFDFAD"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
