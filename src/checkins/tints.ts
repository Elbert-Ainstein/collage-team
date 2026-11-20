/**
 * Avatar tints: earth pigments from src/styles/palette.css, one per slot.
 *
 * Hex rather than var(--c-*) for two reasons: the colour is saved on the
 * student row (avatar_tint), and the student stack appends an alpha byte to it
 * (`${tint}22`), which only works on a literal six-digit hex.
 *
 * Every one carries white initials at 4.5:1 or better.
 */
export const TINTS: readonly string[] = [
  "#4d6878", // slate
  "#634b7d", // plum
  "#9c4a57", // madder
  "#93701f", // ochre
  "#5a6e48", // sage
  "#3d6b66", // verdigris
  "#535a7e", // dusty indigo
  "#b04a24", // terracotta
  "#34594f", // pine
  "#7b4a5e", // mulberry
];

/**
 * The bright tints from before the Gouache palette, slot for slot. Rows created
 * then still hold these, so they are repainted on the way to the screen rather
 * than rewritten in the database.
 */
export const LEGACY_TINTS: readonly string[] = [
  "#0382ed", "#8a3ffc", "#d1449c", "#e8710a", "#1f9d55",
  "#0f9bb0", "#6b47dc", "#c2410c", "#0d7a6f", "#b4237a",
];

const REPAINT: ReadonlyMap<string, string> = new Map(LEGACY_TINTS.map((old, i) => [old, TINTS[i]]));

/** A stable tint for a name: same name, same colour, on every screen. */
export function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** A saved tint as it should be drawn now: old brights become their pigment, anything else is left alone. */
export function paletteTint(tint: string): string {
  return REPAINT.get(tint.toLowerCase()) ?? tint;
}
