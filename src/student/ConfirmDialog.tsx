"use client";

// The one place the student view asks "are you sure?".
//
// window.confirm is suppressed in this environment, so a destructive action had
// been arming itself and saying the cost in its own label — a control that
// changes its mind mid-sentence, and one nobody reads. This is the same question
// asked properly: it names what goes, it defaults to Cancel, and Escape is
// always the way out.
//
// Deliberately the same behaviour as the faculty dialog (src/faculty/
// ConfirmDialog.tsx) rather than an import of it: that one is styled in `fv-`
// tokens, and the two views do not share a stylesheet. The ACCESSIBILITY is
// what matters and is copied exactly — focus starts on Cancel, Tab is trapped,
// Escape cancels, and a backdrop click only counts if it starts and ends there.

import { useCallback, useEffect, useRef, type ReactNode } from "react";

/** Everything inside the dialog that can hold focus, in tab order. */
const FOCUSABLE =
  "button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  busyLabel = "Working…",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** What goes with it — a sentence, or null when there is nothing to add. */
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);

  // Cancel takes focus, never the destructive button: a stray Enter still
  // travelling from the click that opened this must not delete anything.
  useEffect(() => {
    cancel.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep Tab inside: behind this is a whole screen of controls that are not
      // answering this question.
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  return (
    <div
      className="sv-overlay"
      role="presentation"
      onKeyDown={onKeyDown}
      // Only a click that both starts and ends on the backdrop dismisses, so a
      // drag that began on the text inside cannot close it by accident.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="sv-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sv-dialog-title"
        ref={panel}
      >
        <h2 className="sv-dialogtitle" id="sv-dialog-title">
          {title}
        </h2>
        {body ? <div className="sv-dialogbody">{body}</div> : null}
        <div className="sv-dialogbtns">
          <button
            type="button"
            className="sv-btn outline"
            ref={cancel}
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="button" className="sv-btn danger" disabled={busy} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
