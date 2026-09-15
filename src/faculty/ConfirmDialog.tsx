"use client";

// The one place this app asks "are you sure?".
//
// window.confirm is suppressed in this environment, which is why deletes used to
// arm themselves and say the cost in their own label — a control that changed
// its mind mid-sentence. This is the same question asked properly: it says what
// goes, it defaults to Cancel, and Escape is always the way out.

import { useCallback, useEffect, useRef, type ReactNode } from "react";

/** Everything inside the dialog that can hold focus, in tab order. */
const FOCUSABLE = "button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  busyLabel = "Deleting…",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  /** What goes with it — a sentence, or null while it is still being counted. */
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  /** What the confirm button reads while `busy`. */
  busyLabel?: string;
  /**
   * Red for something that cannot be undone. "primary" for a question that is
   * a warning rather than a threat — releasing a grade early is a thing to be
   * sure about, not a thing that deletes anything.
   */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);

  // Cancel is what gets focus, never the destructive button: a stray Enter
  // arriving from the click that opened this must not delete anything.
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
      // Keep Tab inside the dialog — behind it is a whole screen of controls
      // that are not answering this question.
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
      className="fv-overlay"
      role="presentation"
      onKeyDown={onKeyDown}
      // Only a click that both starts and ends on the backdrop dismisses, so a
      // drag that began on the text inside cannot close it by accident.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="fv-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fv-dialog-title"
        ref={panel}
      >
        <h2 className="fv-dialogtitle" id="fv-dialog-title">
          {title}
        </h2>
        {body ? <div className="fv-dialogbody">{body}</div> : null}
        <div className="fv-dialogbtns">
          <button
            type="button"
            className="fv-btn ghost sm"
            ref={cancel}
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`fv-btn ${tone} sm`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
