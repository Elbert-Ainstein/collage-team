// Attaching images to the grading comment (0046), on the real grading screen
// with the real hook — only the network is stubbed.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ActivityType } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";

vi.mock("@/checkins/data", () => ({ openResultsFor: vi.fn(async () => 0) }));

vi.mock("./facultyData", () => ({
  addRubricItem: vi.fn(async () => undefined),
  clearMark: vi.fn(async () => undefined),
  ensureRubric: vi.fn(async () => []),
  listMarks: vi.fn(async () => []),
  releaseMany: vi.fn(async () => ({ released: 0, failed: 0 })),
  releaseMark: vi.fn(async () => undefined),
  seedComboIfBlank: vi.fn(async () => false),
  sendForReview: vi.fn(async () => undefined),
  sendManyForReview: vi.fn(async () => ({ sent: 0, failed: 0 })),
  setActivityPoints: vi.fn(async () => undefined),
  setFeedback: vi.fn(async () => undefined),
  setMark: vi.fn(async () => undefined),
  updateRubricItem: vi.fn(async () => undefined),
}));

vi.mock("./SubmissionPages", () => ({ SubmissionPages: () => <div>PAGES VIEWER</div> }));
vi.mock("./ActivityTeamPanel", () => ({ ActivityTeamPanel: () => null }));

const stored = [
  { id: "img1", result_id: "r1", path: "c1/act1/r1/one.png", mime: "image/png", created_by: "u", created_at: "1" },
];
const listFeedbackImages = vi.fn(async (_ids: string[]) => stored);
const uploadFeedbackImage = vi.fn(async (_t: unknown, f: File) => ({
  id: `new-${f.name}`,
  result_id: "r1",
  path: `c1/act1/r1/${f.name}`,
  mime: f.type,
  created_by: "u",
  created_at: "2",
}));
const deleteFeedbackImage = vi.fn(async () => undefined);
const feedbackImageUrls = vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`])));

vi.mock("@/checkins/feedbackImages", async (orig) => ({
  ...(await orig<typeof import("@/checkins/feedbackImages")>()),
  listFeedbackImages,
  uploadFeedbackImage,
  deleteFeedbackImage,
  feedbackImageUrls,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GradingScreen } = await import("./GradingScreen");

const activity = (type: ActivityType): Activity =>
  ({
    id: "act1",
    course_id: "c1",
    week: 3,
    title: "Week 3",
    type,
    stage: 2,
    position: 3,
    resubmit_mode: "team",
  }) as Activity;

function facultyData(type: ActivityType, grade = true): FacultyData {
  return {
    course: { id: "c1", name: "AP 50", code: "AP50" },
    weeks: [],
    roster: [{ id: "s1", name: "Ada Lovelace", avatar_tint: null, course_id: "c1", position: 0, email: null }],
    activities: [activity(type)],
    questions: [],
    checkIns: [
      { id: "ci-i", activity_id: "act1", kind: "individual", label: "Individual" },
      { id: "ci-t", activity_id: "act1", kind: "team", label: "Team" },
    ],
    results: [
      {
        id: "r1",
        check_in_id: "ci-i",
        student_id: "s1",
        team_id: null,
        status: "submitted",
        submitted_at: "2026-09-01T10:00:00Z",
      },
    ],
    teams: [],
    tfs: [],
    stats: new Map(),
    can: {
      isOwner: grade,
      author: grade,
      grade,
      release: grade,
      rubric: grade,
      runCheckIns: true,
      manageRoster: grade,
      manageTFs: grade,
    },
  } as unknown as FacultyData;
}

let host: HTMLDivElement;
let root: Root;
const onError = vi.fn();

async function mount(data: FacultyData): Promise<void> {
  await act(async () => {
    root.render(
      <GradingScreen
        data={data}
        activity={data.activities[0]}
        onBack={() => undefined}
        onOpenCheckIn={() => undefined}
        onChanged={() => undefined}
        onError={onError}
      />,
    );
  });
  // The image list and its signed links resolve after the first paint.
  await act(async () => undefined);
}

const thumbs = () => Array.from(host.querySelectorAll<HTMLImageElement>(".fv-cimg-thumb img"));
const attachInput = () => host.querySelector<HTMLInputElement>('input[type="file"][aria-label^="Attach images"]');
const png = (name: string) => new File(["x"], name, { type: "image/png" });

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

describe.each<ActivityType>(["combo", "challenge", "amplify"])("the comment on a %s", (type) => {
  it("shows the images already attached to this student's result", async () => {
    await mount(facultyData(type));
    expect(listFeedbackImages).toHaveBeenCalledWith(["r1"]);
    expect(thumbs().map((i) => i.src)).toEqual(["https://signed/c1/act1/r1/one.png"]);
  });

  it("attaches an image chosen from the button", async () => {
    await mount(facultyData(type));
    const input = attachInput();
    expect(input).not.toBeNull();

    Object.defineProperty(input, "files", { value: [png("diagram.png")], configurable: true });
    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(uploadFeedbackImage).toHaveBeenCalledWith(
      { courseId: "c1", activityId: "act1", resultId: "r1" },
      expect.objectContaining({ name: "diagram.png" }),
    );
    expect(thumbs()).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("attaching", () => {
  it("attaches a pasted screenshot from the comment box", async () => {
    await mount(facultyData("combo"));
    const ta = host.querySelector<HTMLTextAreaElement>("textarea.fv-ta")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [png("shot.png")] } });
    await act(async () => {
      ta.dispatchEvent(paste);
    });
    expect(uploadFeedbackImage).toHaveBeenCalledTimes(1);
    expect(paste.defaultPrevented).toBe(true);
  });

  it("leaves pasted text alone", async () => {
    await mount(facultyData("combo"));
    const ta = host.querySelector<HTMLTextAreaElement>("textarea.fv-ta")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [] } });
    await act(async () => {
      ta.dispatchEvent(paste);
    });
    expect(uploadFeedbackImage).not.toHaveBeenCalled();
    expect(paste.defaultPrevented).toBe(false);
  });

  it("refuses a file that isn't a usable image without sending it", async () => {
    await mount(facultyData("challenge"));
    const input = attachInput()!;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "IMG.HEIC", { type: "image/heic" })],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(uploadFeedbackImage).not.toHaveBeenCalled();
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/HEIC/);
  });

  it("removes an image", async () => {
    await mount(facultyData("amplify"));
    const x = host.querySelector<HTMLButtonElement>('button[aria-label="Remove this image"]')!;
    await act(async () => {
      x.click();
    });
    expect(deleteFeedbackImage).toHaveBeenCalledWith(expect.objectContaining({ id: "img1" }));
    expect(thumbs()).toHaveLength(0);
  });

  it("says to run 0046, instead of offering a button that can only fail", async () => {
    const { FeedbackImagesNotInstalledError } = await import("@/checkins/feedbackImages");
    listFeedbackImages.mockRejectedValueOnce(new FeedbackImagesNotInstalledError());
    await mount(facultyData("combo"));
    expect(host.textContent).toContain("0046_feedback_images.sql");
    expect(attachInput()).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
