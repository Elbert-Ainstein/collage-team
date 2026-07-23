/**
 * NotebookLM-style shell variant: floating rounded panels on a cream-100
 * background. On in dev via `?nb`, or baked in with VITE_NOTEBOOK=1 (the
 * second artifact build).
 */
export const NOTEBOOK: boolean =
  new URLSearchParams(window.location.search).has('nb') ||
  String(import.meta.env.VITE_NOTEBOOK ?? '') === '1'

/** Dashboard-landing variant (the Eduaide-style shell) — the third artifact build. */
export const DASHBOARD_LANDING: boolean = String(import.meta.env.VITE_DASHBOARD ?? '') === '1'

/**
 * Dashboard shell: the working app (editor, wizard, galleries) rendered with
 * the light on-background sidebar and floating canvas. On via `?dash` in dev,
 * always on in the dashboard artifact.
 */
export const DASH_SHELL: boolean =
  new URLSearchParams(window.location.search).has('dash') || DASHBOARD_LANDING

/** Any floating-panel shell (notebook or dashboard). */
export const FLOATING: boolean = NOTEBOOK || DASH_SHELL
