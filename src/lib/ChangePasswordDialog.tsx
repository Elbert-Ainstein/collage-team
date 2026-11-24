"use client";

// Change the password of the signed-in account, from either app's sidebar.
//
// One component for both views. They do not share a stylesheet (fv- tokens for
// faculty, sv- for students), so `skin` picks which app's classes it wears —
// the same dialog shell each view's ConfirmDialog already uses, plus a few
// field rules each stylesheet carries. Behaviour is the dialog convention here:
// Escape and the backdrop cancel, Tab stays inside.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { requireSupabase } from "@/lib/supabaseClient";
import {
  MIN_PASSWORD_LENGTH,
  changePassword,
  type PasswordChangeInput,
  type PasswordChangeResult,
  type PasswordField as Field,
} from "./changePassword";

export type DialogSkin = "fv" | "sv";

const SKINS: Record<DialogSkin, { cancel: string; submit: string; input: string }> = {
  fv: { cancel: "fv-btn ghost sm", submit: "fv-btn primary sm", input: "fv-in" },
  sv: { cancel: "sv-btn outline", submit: "sv-btn primary", input: "sv-in" },
};

const FOCUSABLE =
  "button:not(:disabled), [href], input:not([type='hidden']):not(:disabled), select, textarea, [tabindex]:not([tabindex='-1'])";

const EMPTY: PasswordChangeInput = { current: "", next: "", confirm: "" };

export interface ChangePasswordDialogProps {
  skin: DialogSkin;
  /** The signed-in address, handed to password managers so they update the right entry. */
  account?: string;
  onClose: () => void;
  /** For tests. Defaults to the app's Supabase client. */
  submit?: (input: PasswordChangeInput) => Promise<PasswordChangeResult>;
}

const live = (input: PasswordChangeInput) =>
  changePassword(requireSupabase().auth, input);

export function ChangePasswordDialog({
  skin,
  account,
  onClose,
  submit = live,
}: ChangePasswordDialogProps): JSX.Element {
  const s = SKINS[skin];
  const id = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  const doneBtn = useRef<HTMLButtonElement | null>(null);
  const [values, setValues] = useState<PasswordChangeInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ error: string; field?: Field } | null>(null);
  const [done, setDone] = useState(false);

  // Back to whatever opened this when it closes, so a keyboard is not dropped
  // at the top of the page. Declared before the effect below so it reads the
  // opener before focus moves into the dialog.
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    (done ? doneBtn : first).current?.focus();
  }, [done]);

  // Closing mid-request would hide whether it worked, so the way out waits.
  const cancel = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    },
    [cancel],
  );

  const set = (field: Field) => (next: string) => {
    setValues((v) => ({ ...v, [field]: next }));
    if (problem?.field === field) setProblem(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await submit(values);
    setBusy(false);
    if (result.ok) {
      setValues(EMPTY);
      setDone(true);
    } else {
      setProblem({ error: result.error, field: result.field });
    }
  };

  const titleId = `${id}-title`;
  const errorId = `${id}-error`;

  return (
    <div
      className={`${skin}-overlay`}
      role="presentation"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div className={`${skin}-dialog`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <h2 className={`${skin}-dialogtitle`} id={titleId}>
          {done ? "Password changed" : "Change password"}
        </h2>

        {done ? (
          <>
            <div className={`${skin}-dialogbody`} role="status">
              Use the new one next time you sign in.
            </div>
            <div className={`${skin}-dialogbtns`}>
              <button type="button" className={s.submit} ref={doneBtn} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            {/* Lets a password manager tie the new password to this address. */}
            {account?.includes("@") ? (
              <input type="email" autoComplete="username" value={account} readOnly hidden />
            ) : null}
            <div className={`${skin}-pwform`}>
              <PasswordInput
                skin={skin}
                inputClass={s.input}
                label="Current password"
                autoComplete="current-password"
                value={values.current}
                onChange={set("current")}
                invalid={problem?.field === "current"}
                errorId={errorId}
                inputRef={first}
                disabled={busy}
              />
              <PasswordInput
                skin={skin}
                inputClass={s.input}
                label="New password"
                autoComplete="new-password"
                value={values.next}
                onChange={set("next")}
                invalid={problem?.field === "next"}
                errorId={errorId}
                placeholder={`at least ${MIN_PASSWORD_LENGTH} characters`}
                disabled={busy}
              />
              <PasswordInput
                skin={skin}
                inputClass={s.input}
                label="Confirm new password"
                autoComplete="new-password"
                value={values.confirm}
                onChange={set("confirm")}
                invalid={problem?.field === "confirm"}
                errorId={errorId}
                disabled={busy}
              />
            </div>
            <div className={`${skin}-pwerr`} id={errorId} role="alert">
              {problem?.error ?? ""}
            </div>
            <div className={`${skin}-dialogbtns`}>
              <button type="button" className={s.cancel} disabled={busy} onClick={cancel}>
                Cancel
              </button>
              <button type="submit" className={s.submit} disabled={busy}>
                {busy ? "Saving…" : "Change password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface PasswordInputProps {
  skin: DialogSkin;
  inputClass: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  errorId: string;
  placeholder?: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * A password box you can read back, as on the sign-in form: the reveal is per
 * field, starts off, and is not remembered.
 */
function PasswordInput({
  skin,
  inputClass,
  label,
  autoComplete,
  value,
  onChange,
  invalid,
  errorId,
  placeholder,
  disabled,
  inputRef,
}: PasswordInputProps): JSX.Element {
  const [shown, setShown] = useState(false);
  return (
    <label className={`${skin}-pwfld`}>
      {label}
      <span className={`${skin}-pw`}>
        <input
          ref={inputRef}
          className={inputClass}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          // The wrapping label also holds the Show button, whose text would
          // otherwise be read as part of this box's name.
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
        />
        <button
          type="button"
          className={`${skin}-pwbtn`}
          aria-pressed={shown}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
