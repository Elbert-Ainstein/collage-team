"use client";

/**
 * In place of a question this copy of the page can't show (isKnownKind): the
 * tab was opened before that kind of question shipped. A reload lands back on
 * the same assignment (StudentApp keeps where you were).
 */
export function NeedsReload({ reload = () => window.location.reload() }: { reload?: () => void }) {
  return (
    <div className="lq-scard lq-needsreload" role="alert">
      <p className="fv-sub">This question needs the latest version of Collage.</p>
      <button type="button" className="fv-btn primary" onClick={reload}>
        Reload
      </button>
    </div>
  );
}
