"use client";

// How the assistant panel reaches the form on screen.
//
// The panel sits beside every screen (FacultyApp), and the team evaluation
// builder is three components deep in one of them. Rather than lift the
// builder's state up to where both can see it, the builder registers a handle
// here while it is mounted: a way to read its form as it stands and a way to
// fill it. The panel reads the handle when she sends a message, and fills
// through it when a draft comes back.
//
// Registering is by a ref-backed handle, not by state: the form changes on
// every keystroke, and only whether a builder is open — not what is typed in
// it — should make the panel draw again.

import { createContext, useContext, useSyncExternalStore } from "react";
import type { TeamEvalProposal } from "@/assistant/types";
import { fillForm, revertFill, type FormLimits, type TeamEvalForm } from "./teamEvalFill";
import type { FormFill } from "./thread";

export interface TeamEvalFormHandle {
  kind: "teameval";
  /** One open builder, as opposed to the next one — an Undo belongs to the builder it filled. */
  id: string;
  /** The form as it stands, unsaved edits included. */
  read: () => TeamEvalForm;
  /** Replace the form with this. Writes nothing; her Save does. */
  fill: (next: TeamEvalForm, opts: { showForm: boolean }) => void;
  limits: FormLimits;
  /** What the builder's save button says, for "press Finish to keep it". */
  saveLabel: string;
}

export interface FormBridge {
  get: () => TeamEvalFormHandle | null;
  /** Register the open builder. */
  open: (handle: TeamEvalFormHandle) => void;
  /** Unregister it — only if it is still the one registered. */
  close: (handle: TeamEvalFormHandle) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createFormBridge(): FormBridge {
  let current: TeamEvalFormHandle | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => current,
    open: (handle) => {
      current = handle;
      emit();
    },
    close: (handle) => {
      // A builder unmounting after the next one mounted must not close that one.
      if (current?.id !== handle.id) return;
      current = null;
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const FormBridgeContext = createContext<FormBridge | null>(null);

export function useFormBridge(): FormBridge | null {
  return useContext(FormBridgeContext);
}

const nothing = () => () => undefined;
const none = () => null;

/** The builder open right now, or null — re-rendering only when that changes. */
export function useOpenForm(bridge: FormBridge | null): TeamEvalFormHandle | null {
  return useSyncExternalStore(bridge?.subscribe ?? nothing, bridge?.get ?? none, none);
}

/**
 * Put a draft into the builder open now. Null when none is: the card then
 * waits, with its Fill in button, for her to open one.
 */
export function fillThrough(bridge: FormBridge | null, draft: TeamEvalProposal): FormFill | null {
  const handle = bridge?.get();
  if (!handle) return null;
  const before = handle.read();
  const out = fillForm(before, draft, handle.limits);
  if (out.changes.length) handle.fill(out.next, { showForm: out.showForm });
  return {
    before,
    handleId: handle.id,
    fields: out.fields,
    changes: out.changes,
    skipped: out.skipped,
    saveLabel: handle.saveLabel,
  };
}

/** Put back what `fill` changed — only into the builder it filled, and nothing typed since. */
export function undoThrough(bridge: FormBridge | null, fill: FormFill): boolean {
  const handle = bridge?.get();
  if (!handle || handle.id !== fill.handleId) return false;
  handle.fill(revertFill(handle.read(), fill.before, fill.fields), { showForm: false });
  return true;
}
