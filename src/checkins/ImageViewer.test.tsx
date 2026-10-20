// The full-screen viewer: opens where it was asked to, steps through the set,
// keeps its keys from the screen behind it, and lets you out every way Drive does.

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageViewer, type ViewerImage } from "./ImageViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const images: ViewerImage[] = [
  { id: "1", url: "https://x/one.png", name: "Corrected FBD.png" },
  { id: "2", url: "https://x/two.png", name: "Screenshot.png" },
  { id: "3", url: "https://x/three.png", name: "Q3.jpg" },
];

let host: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onDownload = vi.fn(async () => undefined);

function Harness({ start = 0, set = images }: { start?: number; set?: ViewerImage[] }) {
  const [i, setI] = useState(start);
  return <ImageViewer images={set} index={i} onIndex={setI} onClose={onClose} onDownload={onDownload} />;
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const shown = () => dialog().querySelector<HTMLImageElement>(".iv-img")!.src;
const press = (key: string) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
const click = (label: string) =>
  act(async () => {
    dialog().querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click();
  });

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

describe("the image viewer", () => {
  it("opens on the image pressed, named, with where it is in the set", async () => {
    await act(async () => root.render(<Harness start={1} />));
    expect(shown()).toBe("https://x/two.png");
    expect(dialog().textContent).toContain("Screenshot.png");
    expect(dialog().textContent).toContain("2 of 3");
  });

  it("steps with the arrows and the keys, wrapping at the ends", async () => {
    await act(async () => root.render(<Harness />));
    await click("Next image");
    expect(shown()).toBe("https://x/two.png");
    await press("ArrowLeft");
    await press("ArrowLeft");
    expect(shown()).toBe("https://x/three.png");
  });

  it("keeps ←/→ from the screen behind it", async () => {
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    await act(async () => root.render(<Harness />));
    await press("ArrowRight");
    window.removeEventListener("keydown", behind);
    expect(behind).not.toHaveBeenCalled();
  });

  it("closes on Esc, on the close button and on the dark around the image", async () => {
    await act(async () => root.render(<Harness />));
    await press("Escape");
    await click("Close");
    await act(async () => {
      dialog().querySelector<HTMLElement>(".iv-stage")!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("doesn't close on a click on the image itself", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      dialog().querySelector<HTMLElement>(".iv-img")!.click();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("zooms in and back to fit", async () => {
    await act(async () => root.render(<Harness />));
    expect(dialog().textContent).toContain("Fit");
    await click("Zoom in");
    expect(dialog().textContent).toContain("150%");
    await press("0");
    expect(dialog().textContent).toContain("Fit");
  });

  it("downloads the one on screen", async () => {
    await act(async () => root.render(<Harness start={2} />));
    await click("Download");
    expect(onDownload).toHaveBeenCalledWith(2);
  });

  it("shows no arrows or count for a single image", async () => {
    await act(async () => root.render(<Harness set={[images[0]]} />));
    expect(dialog().querySelector('[aria-label="Next image"]')).toBeNull();
    expect(dialog().textContent).not.toContain("1 of 1");
  });
});
