// A student sees the images on their comment once the grade is released, and
// not a moment before — the same gate the comment text passes through.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listFeedbackImages = vi.fn(async (_ids: string[]) => [
  { id: "img1", result_id: "r1", path: "c1/a1/r1/one.png", mime: "image/png", name: "one.png", created_by: "u", created_at: "1" },
]);
const feedbackImageUrls = vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`])));

vi.mock("@/checkins/feedbackImages", async (orig) => ({
  ...(await orig<typeof import("@/checkins/feedbackImages")>()),
  listFeedbackImages,
  feedbackImageUrls,
}));
vi.mock("@/checkins/data", () => ({ dbError: (e: { message: string }) => new Error(e.message) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { FeedbackImageGrid, useReleasedFeedbackImages } = await import("./FeedbackImages");

function Harness({ released }: { released: boolean }) {
  return <FeedbackImageGrid state={useReleasedFeedbackImages("r1", released)} />;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(released: boolean): Promise<void> {
  await act(async () => root.render(<Harness released={released} />));
  await act(async () => undefined);
}

describe("images on the comment, for the student", () => {
  it("are not even asked for before the grade is released", async () => {
    await mount(false);
    expect(listFeedbackImages).not.toHaveBeenCalled();
    expect(host.querySelector("img")).toBeNull();
  });

  it("show under the comment once it is", async () => {
    await mount(true);
    expect(listFeedbackImages).toHaveBeenCalledWith(["r1"]);
    const img = host.querySelector<HTMLImageElement>(".sv-fimg img");
    expect(img?.src).toBe("https://signed/c1/a1/r1/one.png");
  });

  it("open full screen, at the one pressed", async () => {
    await mount(true);
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".sv-fimg-open")!.click();
    });
    const viewer = document.querySelector('[role="dialog"]');
    expect(viewer?.getAttribute("aria-label")).toBe("one.png, image 1 of 1");
    expect(viewer?.querySelector<HTMLImageElement>(".iv-img")?.src).toBe("https://signed/c1/a1/r1/one.png");
  });

  it("appear when a grade is released while the page is open", async () => {
    await mount(false);
    await mount(true);
    expect(host.querySelectorAll(".sv-fimg img")).toHaveLength(1);
  });
});
