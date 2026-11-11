// The bar that tells a tab left open across a deploy to reload.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBar } from "./UpdateBar";
import { MIN_GAP_MS } from "./useNewerBuild";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
/** Comes back to the tab, after long enough that it's worth asking. */
const comeBack = async () => {
  await act(async () => {
    vi.advanceTimersByTime(MIN_GAP_MS + 1);
    document.dispatchEvent(new Event("visibilitychange"));
  });
};
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);

describe("UpdateBar", () => {
  it("says nothing on a fresh load", async () => {
    const fetchBuild = vi.fn(async () => "b2");
    await show(<UpdateBar mine="b1" fetchBuild={fetchBuild} />);
    expect(host.textContent).toBe("");
    expect(fetchBuild).not.toHaveBeenCalled();
  });

  it("offers a reload once the server is on a newer build", async () => {
    const reload = vi.fn();
    await show(<UpdateBar mine="b1" fetchBuild={async () => "b2"} reload={reload} />);
    await comeBack();
    expect(host.textContent).toContain("Collage has been updated");
    await act(async () => button("Reload")!.click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stays quiet while the server is on the same build", async () => {
    const fetchBuild = vi.fn(async () => "b1");
    await show(<UpdateBar mine="b1" fetchBuild={fetchBuild} />);
    await comeBack();
    expect(fetchBuild).toHaveBeenCalledOnce();
    expect(host.textContent).toBe("");
  });

  it("asks at most once a minute, however often the tab comes back", async () => {
    const fetchBuild = vi.fn(async () => "b1");
    await show(<UpdateBar mine="b1" fetchBuild={fetchBuild} />);
    await comeBack();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchBuild).toHaveBeenCalledOnce();
  });

  it("never asks on a build without an id", async () => {
    const fetchBuild = vi.fn(async () => "b2");
    await show(<UpdateBar mine="dev" fetchBuild={fetchBuild} />);
    await comeBack();
    expect(fetchBuild).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });

  it("can be put off", async () => {
    await show(<UpdateBar mine="b1" fetchBuild={async () => "b2"} reload={vi.fn()} />);
    await comeBack();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Not now"]')!.click());
    expect(host.textContent).toBe("");
  });
});
