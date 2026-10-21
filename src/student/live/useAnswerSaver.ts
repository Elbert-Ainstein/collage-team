"use client";

// Saving a student's own answers as they go: a tapped choice at once, a typed
// number or expression once they pause. Each question says where it stands —
// saving, saved, or failed with the reason — so nobody walks into class
// thinking an answer went in when it didn't.
//
// Saves to one question go out one after another, newest last: two quick taps
// (A, then B) sent side by side could land B-then-A and leave A on the server
// under a screen that says B. And leaving mid-pause still saves what was typed.

import { useCallback, useEffect, useRef, useState } from "react";
import { saveMyAnswer } from "@/live/data";
import { forStudent } from "./forStudent";

const TYPING_MS = 600;

export type SaveState = { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

export interface AnswerSaver {
  /** What they've given, over what was loaded: questionId → answer. */
  answers: Record<string, string>;
  state: Record<string, SaveState>;
  /** `typed` waits for a pause; a tap saves now. */
  save: (questionId: string, answer: string, typed?: boolean) => void;
}

export function useAnswerSaver(activityId: string, studentId: string, loaded: Record<string, string>): AnswerSaver {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, SaveState>>({});
  const alive = useRef(true);
  /** Typed answers waiting for the pause: questionId → [timer, answer]. */
  const waiting = useRef(new Map<string, [number, string]>());
  /** The save in flight per question; the next one waits for it. */
  const queue = useRef(new Map<string, Promise<void>>());
  const latest = useRef(new Map<string, string>());

  const show = (questionId: string, st: SaveState) => {
    if (alive.current) setState((s) => ({ ...s, [questionId]: st }));
  };

  const write = useCallback(
    (questionId: string, answer: string) => {
      const run = async () => {
        // Overtaken while queued: the newer answer is the one to send.
        if (latest.current.get(questionId) !== answer) return;
        show(questionId, { kind: "saving" });
        try {
          await saveMyAnswer({ activityId, questionId, studentId, answer });
          if (latest.current.get(questionId) === answer) show(questionId, { kind: "saved" });
        } catch (e) {
          show(questionId, { kind: "failed", message: forStudent(e, "Didn’t save — check your connection") });
        }
      };
      const next = (queue.current.get(questionId) ?? Promise.resolve()).then(run);
      queue.current.set(questionId, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activityId, studentId],
  );

  // Leaving (back to the list, or team mode starting) sends what's still waiting.
  useEffect(() => {
    alive.current = true;
    const pending = waiting.current;
    return () => {
      alive.current = false;
      for (const [questionId, [timer, answer]] of pending) {
        window.clearTimeout(timer);
        write(questionId, answer);
      }
      pending.clear();
    };
  }, [write]);

  const save = useCallback(
    (questionId: string, answer: string, typed = false) => {
      latest.current.set(questionId, answer);
      setAnswers((a) => ({ ...a, [questionId]: answer }));
      const prior = waiting.current.get(questionId);
      if (prior) window.clearTimeout(prior[0]);
      waiting.current.delete(questionId);
      if (!typed) {
        write(questionId, answer);
        return;
      }
      show(questionId, { kind: "saving" });
      const timer = window.setTimeout(() => {
        waiting.current.delete(questionId);
        write(questionId, answer);
      }, TYPING_MS);
      waiting.current.set(questionId, [timer, answer]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [write],
  );

  return { answers: { ...loaded, ...answers }, state, save };
}
