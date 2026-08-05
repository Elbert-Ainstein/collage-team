// The hand-in is two screens, and which one you get is decided by one thing:
// whether a PDF is already up. Getting that backwards is not a cosmetic slip —
// step two's page grid is meaningless without a document, and step one's
// dropzone shown over an existing submission invites a student to replace work
// they meant to keep. So both directions are pinned here.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionFile } from "@/checkins/submissions";

const file: SubmissionFile = {
  id: "f1",
  result_id: "r1",
  path: "c1/a1/r1/x.pdf",
  page_count: 3,
  created_by: "u1",
  created_at: "2026-08-05T00:00:00Z",
};

// Every data call is stubbed: this is about which screen renders, not about
// Supabase. `current` is what getSubmissionFile answers with.
const current = { value: null as SubmissionFile | null };

vi.mock("@/checkins/submissions", () => ({
  getSubmissionFile: vi.fn(async () => current.value),
  listSubmissionPages: vi.fn(async () => []),
  submissionUrl: vi.fn(async () => "blob:pdf"),
  clearSubmission: vi.fn(async () => undefined),
  setQuestionPages: vi.fn(async () => undefined),
  uploadSubmissionPdf: vi.fn(async () => file),
}));

// pdfjs is dynamically imported for thumbnails. jsdom has no canvas, and the
// thumbnails are not what is under test.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 130 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
      destroy: async () => undefined,
    }),
  }),
}));

// React only accepts act() when it is told it is in a test environment, and
// jsdom has no canvas — without both, every run buries real failures in pages
// of warnings. The null context is also what the component's own `if (!ctx)`
// guard expects, so thumbnails are simply skipped here.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const { PdfSubmit } = await import("./PdfSubmit");

const questions = [
  { id: "q1", activity_id: "a1", label: "1", position: 1, points: 5, created_at: "" },
  { id: "q2", activity_id: "a1", label: "2", position: 2, points: 5, created_at: "" },
];

let host: HTMLDivElement;
let root: Root;

async function mount(): Promise<string> {
  await act(async () => {
    root.render(
      <PdfSubmit
        resultId="r1"
        courseId="c1"
        activityId="a1"
        questions={questions as never}
        locked={false}
        onChanged={() => undefined}
      />,
    );
  });
  return host.textContent ?? "";
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("PdfSubmit", () => {
  it("shows only the upload step when nothing has been handed in", async () => {
    current.value = null;
    const text = await mount();

    expect(text).toContain("Step 1 of 2");
    expect(text).toContain("Upload your work as a PDF");

    // The mapping controls must not be on this screen: with no document there
    // is nothing for them to point at.
    expect(text).not.toContain("Step 2 of 2");
    expect(text).not.toContain("Pick a question");
    expect(host.querySelectorAll("[aria-pressed]")).toHaveLength(0);
  });

  it("shows the page-mapping step once a PDF is up", async () => {
    current.value = file;
    const text = await mount();

    expect(text).toContain("Step 2 of 2");
    expect(text).toContain("Pick a question");
    expect(text).toContain("3 pages");

    // One chip per question, and the first is selected so the very first click
    // on a page lands somewhere rather than being swallowed.
    const chips = host.querySelectorAll('button[aria-pressed][type="button"]');
    expect(chips.length).toBeGreaterThanOrEqual(questions.length);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");

    // And the dropzone is gone — replacing is a deliberate, guarded action now.
    expect(text).not.toContain("Step 1 of 2");
    expect(text).not.toContain("Upload your work as a PDF");
    expect(text).toContain("Upload a different PDF");
  });

  it("warns about questions with no pages, naming them", async () => {
    current.value = file;
    const text = await mount();
    expect(text).toContain("No pages yet for 1, 2");
  });
});
