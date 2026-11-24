// The real builder and the real assistant panel, side by side as FacultyApp
// puts them: a fill lands in the builder's own inputs, Finish saves what was
// filled — the first step's instructions included — and Undo takes it back.
// Only the network is stubbed.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantReply, TeamEvalProposal } from "@/assistant/types";
import type { Activity } from "@/checkins/types";
import type { TeamEvalSnapshot } from "@/teameval/types";
import type { FacultyData } from "../FacultyApp";

const askAssistant = vi.fn<(...a: unknown[]) => Promise<AssistantReply>>();
vi.mock("../assistant/client", () => ({ askAssistant }));

const updateActivity = vi.fn(async () => undefined);
vi.mock("@/checkins/data", () => ({
  updateActivity,
  moveStudents: vi.fn(),
  renameTeam: vi.fn(),
  createTeam: vi.fn(),
  deleteTeam: vi.fn(),
  createTeamSet: vi.fn(),
  listTeamSets: vi.fn(),
  countOneTeamResults: vi.fn(async () => 0),
  countOneTeamMarks: vi.fn(async () => 0),
}));
const saveTeamEvalShape = vi.fn(async () => undefined);
const setTeamEvalSettings = vi.fn(async () => undefined);
vi.mock("@/teameval/data", () => ({ saveTeamEvalShape, setTeamEvalSettings }));
vi.mock("@/checkins/resources", () => ({ countResourcesForTeams: vi.fn(async () => 0) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TeamEvalBuilder } = await import("./TeamEvalBuilder");
const { AssistantPanel } = await import("../assistant/AssistantPanel");
const { createFormBridge, FormBridgeContext } = await import("../assistant/formBridge");

const data = {
  course: { id: "c1", name: "AP 50", code: null, term: null },
  roster: [],
  teams: [],
  weeks: [{ id: "w18", week: 18, title: "" }],
} as unknown as FacultyData;

const activity = {
  id: "a1",
  title: "test",
  week: 18,
  due_at: null,
  individual_due_at: null,
  source_text: null,
} as unknown as Activity;

const snapshot: TeamEvalSnapshot = {
  settings: {
    activity_id: "a1",
    peer_comments: true,
    release_comments: true,
    anonymize: true,
    late_penalty: 10,
    released_at: null,
    scored_at: null,
    updated_at: "",
  },
  categories: [],
  questions: [],
  ratings: [],
  comments: [],
  submissions: [],
  notes: [],
};

const levels = (k: string) => ["1", "2", "3", "4", "5"].map((s) => `${k} at ${s}`);

const fromDoc: TeamEvalProposal = {
  kind: "teameval",
  summary: "Fills in the revised AP50 teamwork dimensions.",
  title: null,
  instructions: "For each teammate and for yourself, think about the team's work.\n\n- 3 means the student meets expectations.",
  due: null,
  categories: [
    { name: "Contributing to the Team's Work", levels: levels("Contributing") },
    { name: "Interacting with Teammates", levels: levels("Interacting") },
  ],
  questions: [
    { audience: "peer", prompt: "What is one specific thing this teammate did that helped your team?" },
    { audience: "self", prompt: "What is one specific way you contributed?" },
  ],
  peerComments: null,
  releaseComments: null,
  anonymize: null,
  latePenalty: 20,
  notApplied: ["A “Not enough information” choice"],
};

let host: HTMLDivElement;
let root: Root;

function mount(over: { activity?: Activity; snapshot?: TeamEvalSnapshot } = {}) {
  const bridge = createFormBridge();
  act(() => {
    root.render(
      <FormBridgeContext.Provider value={bridge}>
        <TeamEvalBuilder
          data={data}
          activity={over.activity ?? activity}
          snapshot={over.snapshot ?? snapshot}
          startStep={1}
          onLeave={() => undefined}
          onDone={() => undefined}
          onError={(e) => {
            throw e;
          }}
        />
        <AssistantPanel data={data} hidden={false} onClose={() => undefined} onChanged={() => undefined} onImport={() => undefined} />
      </FormBridgeContext.Provider>,
    );
  });
}

async function ask(text: string) {
  const box = host.querySelector("textarea[aria-label='Ask the assistant']") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

const field = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLTextAreaElement | null;
const penaltyBox = () => host.querySelector(".te-pct input") as HTMLInputElement;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("TeamEvalBuilder with the assistant", () => {
  it("fills the builder from a document, saves it all on Finish, and nothing before", async () => {
    askAssistant.mockResolvedValue({ kind: "proposal", text: fromDoc.summary, proposal: fromDoc });
    mount();
    // The builder's defaults, before.
    expect(field("Category 1 name")?.value).toBe("Contribution");
    expect(host.textContent).toContain("Fill this in from my Google Doc");

    await ask("fill all this out for me: https://docs.google.com/document/d/1nDGFdHqkBX47AoWmrGGkdmVjVtmUF8fCxxh-J3xiEEc/edit");

    // What the panel sent is the builder's own form.
    const [req] = askAssistant.mock.calls[0] as [{ form: { categories: { name: string }[]; latePenalty: string } }];
    expect(req.form.categories.map((c) => c.name)).toEqual(["Contribution", "Communication", "Reliability", "Quality of work", "Respect"]);
    expect(req.form.latePenalty).toBe("10");

    // In the builder's inputs now.
    expect(field("Category 1 name")?.value).toBe("Contributing to the Team's Work");
    expect(field("Contributing to the Team's Work: what 5 means")?.value).toBe("Contributing at 5");
    expect(field("Contributing to the Team's Work: what 1 means")?.value).toBe("Contributing at 1");
    expect(field("Category 3 name")).toBeNull();
    expect(field("For each teammate question 1")?.value).toContain("helped your team");
    expect(field("For each teammate question 2")).toBeNull();
    expect(penaltyBox().value).toBe("20");
    expect(host.querySelector(".te-outof b")?.textContent).toBe("10");
    expect(host.textContent).toContain("Filled in · press Finish to keep it");
    expect(host.textContent).toContain("A “Not enough information” choice");
    // Nothing written yet.
    expect(saveTeamEvalShape).not.toHaveBeenCalled();
    expect(updateActivity).not.toHaveBeenCalled();

    await act(async () => button("Finish").click());
    const [, cats, qs] = saveTeamEvalShape.mock.calls[0] as unknown as [string, { name: string; levels: string[] }[], { audience: string }[]];
    expect(cats.map((c) => c.name)).toEqual(["Contributing to the Team's Work", "Interacting with Teammates"]);
    expect(cats[1].levels).toEqual(levels("Interacting"));
    expect(qs.map((q) => q.audience)).toEqual(["peer", "self"]);
    expect(setTeamEvalSettings).toHaveBeenCalledWith("a1", expect.objectContaining({ late_penalty: 20 }));
    expect(updateActivity).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ points_total: 10, source_text: fromDoc.instructions }),
    );
  });

  it("changes one setting on request and Undo puts it back", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Sets the late penalty to 20%.",
      proposal: { ...fromDoc, instructions: null, categories: null, questions: null, notApplied: [] },
    });
    mount();
    await ask("change the percentage of points you lose if you're late to 20");
    expect(penaltyBox().value).toBe("20");
    expect(field("Category 1 name")?.value).toBe("Contribution");
    expect(host.textContent).toContain("Late penalty 10% → 20%");

    await act(async () => button("Undo").click());
    expect(penaltyBox().value).toBe("10");
  });

  it("saves no first-step field she did not change — a due date read from individual_due_at stays out of due_at", async () => {
    const existing: TeamEvalSnapshot = {
      ...snapshot,
      categories: [{ id: "c1", activity_id: "a1", position: 0, name: "Contribution", levels: levels("C"), created_at: "" }],
      questions: [{ id: "q1", activity_id: "a1", position: 0, audience: "peer", prompt: "One thing they do well", created_at: "" }],
    };
    const dated = { ...activity, due_at: null, individual_due_at: "2026-12-01T17:00:00.000Z", source_text: "Old words" } as unknown as Activity;
    mount({ activity: dated, snapshot: existing });
    await act(async () => button("Save").click());
    const [, patch] = updateActivity.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(patch).not.toHaveProperty("due_at");
    expect(patch).not.toHaveProperty("week");
    expect(patch).not.toHaveProperty("source_text");
    expect(patch).toMatchObject({ title: "test", points_total: 5 });
  });
});
