// Release answers and explanations to individual mode (0053): for a class
// whose team mode never ran, any time before it closes.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveState, LivePhase } from "@/live/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ReleaseAnswers } = await import("./ReleaseAnswers");

/** null: a database without 0053, where the column isn't there at all. */
const stateOf = (phase: LivePhase, teamSkipped: boolean | null = false): LiveState => ({
  activity_id: "a", phase, lock_rule: "any", show_answers: "close", grading: "both",
  team_started_at: null, closed_at: null, scored_at: null, updated_at: "",
  ...(teamSkipped === null ? {} : { team_skipped: teamSkipped }),
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));
const confirmBtn = () => document.querySelector<HTMLButtonElement>(".fv-dialogbtns button:last-child")!;

describe("Release answers and explanations", () => {
  it("asks first, then releases", async () => {
    const release = vi.fn(async () => {});
    await show(<ReleaseAnswers state={stateOf("team")} grades release={release} onError={() => {}} />);
    await act(async () => button("Release answers and explanations")!.click());
    expect(release).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Team mode won’t run");
    await act(async () => confirmBtn().click());
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("is there before class too", async () => {
    await show(<ReleaseAnswers state={stateOf("individual")} grades release={async () => {}} onError={() => {}} />);
    expect(button("Release answers and explanations")).toBeDefined();
  });

  it("says who grades when the one pressing it can't", async () => {
    await show(<ReleaseAnswers state={stateOf("team")} grades={false} release={async () => {}} onError={() => {}} />);
    await act(async () => button("Release answers and explanations")!.click());
    expect(document.body.textContent).toContain("instructor");
  });

  it("hands a failure back and stays put", async () => {
    const onError = vi.fn();
    const err = new Error("nope");
    await show(<ReleaseAnswers state={stateOf("team")} grades release={async () => Promise.reject(err)} onError={onError} />);
    await act(async () => button("Release answers and explanations")!.click());
    await act(async () => confirmBtn().click());
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("isn't there once closed, or without 0053", async () => {
    await show(<ReleaseAnswers state={stateOf("closed")} grades release={async () => {}} onError={() => {}} />);
    expect(button("Release answers and explanations")).toBeUndefined();
    await show(<ReleaseAnswers state={stateOf("team", null)} grades release={async () => {}} onError={() => {}} />);
    expect(button("Release answers and explanations")).toBeUndefined();
  });
});
