// The assistant panel end to end, with the server answer stubbed: what she
// sends, what the draft shows, and that Apply is the only thing that writes.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantReply } from "@/assistant/types";
import type { FacultyData } from "../FacultyApp";
import { ada, alan, roster, team1, team2, teams } from "./fixtures";

const askAssistant = vi.fn<(...a: unknown[]) => Promise<AssistantReply>>();
vi.mock("./client", () => ({ askAssistant }));

const moveStudents = vi.fn(async () => undefined);
const renameTeam = vi.fn(async () => undefined);
const createTeam = vi.fn(async () => ({ id: "new" }));
const deleteTeam = vi.fn(async () => undefined);
vi.mock("@/checkins/data", () => ({
  moveStudents,
  renameTeam,
  createTeam,
  deleteTeam,
  createTeamSet: vi.fn(),
  listTeamSets: vi.fn(),
  countOneTeamResults: vi.fn(async () => 0),
  countOneTeamMarks: vi.fn(async () => 0),
}));
vi.mock("@/checkins/resources", () => ({ countResourcesForTeams: vi.fn(async () => 0) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AssistantPanel, IMPORT_SOURCE } = await import("./AssistantPanel");

const data = {
  course: { id: "c1", name: "AP 50", code: "AP50A", term: "Fall" },
  roster,
  teams,
} as unknown as FacultyData;

let host: HTMLDivElement;
let root: Root;
const onChanged = vi.fn();
const onImport = vi.fn();

function mount() {
  act(() => {
    root.render(
      <AssistantPanel data={data} hidden={false} onClose={() => undefined} onChanged={onChanged} onImport={onImport} />,
    );
  });
}

async function ask(text: string) {
  const box = host.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

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

describe("AssistantPanel", () => {
  it("sends the request with the class as refs, and shows a draft without writing", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Moves Alan Turing to Team 2.",
      proposal: { kind: "seat", summary: "Moves Alan.", moves: [{ student: "s2", toTeam: "t2", toNewTeam: null }], renames: [], unresolved: [] },
    });
    mount();
    await ask("Move Alan to team 2");

    const [req] = askAssistant.mock.calls[0] as [{ message: string; courseId: string; snapshot: { teams: unknown[] } }];
    expect(req.message).toBe("Move Alan to team 2");
    expect(req.courseId).toBe("c1");
    expect(req.snapshot.teams).toEqual([
      { ref: "t1", name: "Team 1", members: ["s1", "s2"] },
      { ref: "t2", name: "Team 2", members: ["s3"] },
    ]);

    expect(host.textContent).toContain("Alan Turing — Team 1 →");
    expect(host.textContent).toContain("Team 2");
    expect(moveStudents).not.toHaveBeenCalled();
  });

  it("writes on Apply, says what it did, and asks for a refresh", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Moves Alan.",
      proposal: { kind: "seat", summary: "Moves Alan.", moves: [{ student: "s2", toTeam: "t2", toNewTeam: null }], renames: [], unresolved: [] },
    });
    mount();
    await ask("Move Alan to team 2");
    await act(async () => button("Apply").click());

    expect(moveStudents).toHaveBeenCalledWith([alan.id], team2.id, [team1.id, team2.id]);
    expect(host.textContent).toContain("Applied — moved 1 student. Nothing was deleted.");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(button("Apply")).toBeUndefined();
  });

  // Some writes may have landed when Apply fails part-way. A retry planned from
  // the class as it was BEFORE them would make the new teams a second time and
  // leave a student on both copies — so the class is re-read first, and Apply
  // stays shut until it has been.
  it("re-reads the class after a failed Apply, and keeps Apply shut until it has", async () => {
    moveStudents.mockRejectedValueOnce(new Error("network down"));
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Moves Alan.",
      proposal: { kind: "seat", summary: "Moves Alan.", moves: [{ student: "s2", toTeam: "t2", toNewTeam: null }], renames: [], unresolved: [] },
    });
    mount();
    await ask("Move Alan to team 2");
    await act(async () => button("Apply").click());

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("network down");
    expect(button("Checking the class…").disabled).toBe(true);

    // The refresh lands: new arrays, same rows.
    const fresh = { ...data, teams: teams.map((t) => ({ ...t })) } as FacultyData;
    act(() => {
      root.render(
        <AssistantPanel data={fresh} hidden={false} onClose={() => undefined} onChanged={onChanged} onImport={onImport} />,
      );
    });
    expect(button("Apply").disabled).toBe(false);
  });

  it("does not pull her off a screen the panel is hidden on to open a list", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Rows.",
      proposal: { kind: "import", summary: "x", rows: [{ name: "Ada Lovelace", email: "ada@x.edu", team: 1 }] },
    });
    mount();
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "Team 1: ada@x.edu");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // She presses send, then opens a grading screen while it thinks.
    let release: (r: AssistantReply) => void = () => undefined;
    askAssistant.mockReturnValueOnce(new Promise((r) => (release = r)));
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    act(() => {
      root.render(
        <AssistantPanel data={data} hidden={true} onClose={() => undefined} onChanged={onChanged} onImport={onImport} />,
      );
    });
    await act(async () =>
      release({
        kind: "proposal",
        text: "Rows.",
        proposal: { kind: "import", summary: "x", rows: [{ name: "Ada Lovelace", email: "ada@x.edu", team: 1 }] },
      }),
    );
    expect(onImport).not.toHaveBeenCalled();
    expect(button("Open in the importer")).toBeDefined();
  });

  it("undoes an applied draft from its own button, putting the student back", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Moves Alan.",
      proposal: { kind: "seat", summary: "Moves Alan.", moves: [{ student: "s2", toTeam: "t2", toNewTeam: null }], renames: [], unresolved: [] },
    });
    mount();
    await ask("Move Alan to team 2");
    await act(async () => button("Apply").click());

    // The refresh after Apply: Alan is on Team 2 now.
    const after = {
      ...data,
      teams: [{ ...team1, members: [ada] }, { ...team2, members: [...team2.members, alan] }],
    } as FacultyData;
    act(() => {
      root.render(
        <AssistantPanel data={after} hidden={false} onClose={() => undefined} onChanged={onChanged} onImport={onImport} />,
      );
    });
    moveStudents.mockClear();
    await act(async () => button("Undo").click());

    expect(moveStudents).toHaveBeenCalledWith([alan.id], team1.id, [team1.id, team2.id]);
    expect(deleteTeam).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Undone — moved 1 student back.");
    expect(button("Undo")).toBeUndefined();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  // Kelly's flow: a class spreadsheet, a sentence of rules, teams formed by code.
  it("forms teams from an attached file by rules — and sends only a summary of the file", async () => {
    const csv = "Name,Email,Gender\nAda Lovelace,ada@x.edu,F\nAlan Turing,alan@x.edu,M\nGrace Hopper,grace@x.edu,F\nKatherine Johnson,kj@x.edu,F";
    mount();
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([csv], "class.csv", { type: "text/csv" });
    // jsdom's Blob has no arrayBuffer; the browser's does.
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(csv).buffer });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.textContent).toContain("class.csv · 4 rows");

    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Teams of 2, nobody with a current teammate, gender balanced.",
      proposal: {
        kind: "form",
        summary: "x",
        teamSize: 2,
        avoidCurrent: true,
        avoidColumns: [],
        nameColumns: ["Name"],
        emailColumn: "Email",
        balance: [{ column: "Gender", kind: "category", values: [] }],
        noIsolation: [],
        atMost: [],
        notApplied: [],
      },
    });
    await ask("Teams of 2, no repeat teammates, balance gender");

    const [req] = askAssistant.mock.calls[0] as [{ attachment: { name: string; rows: number } }];
    expect(req.attachment).toMatchObject({ name: "class.csv", rows: 4 });
    const sent = JSON.stringify(req.attachment);
    expect(sent).not.toContain("Lovelace");
    expect(sent).not.toContain("ada@x.edu");

    expect(host.textContent).toContain("✓ Nobody is on a team with a current teammate.");
    expect(host.textContent).toMatch(/✓ Gender: F 1–2, M 0–1 per team\./);
    await act(async () => button("Apply").click());
    // Ada and Alan are on Team 1 now, so the new teams split them.
    const calls = moveStudents.mock.calls as unknown as [string[], string | null, string[]][];
    const together = calls.find(([ids]) => ids.includes(ada.id) && ids.includes(alan.id));
    expect(together).toBeUndefined();
    expect(moveStudents).toHaveBeenCalled();
    expect(host.textContent).toContain("Applied —");
  });

  it("writes nothing on Discard", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Moves Ada.",
      proposal: { kind: "seat", summary: "Moves Ada.", moves: [{ student: "s1", toTeam: "t2", toNewTeam: null }], renames: [], unresolved: [] },
    });
    mount();
    await ask("Move Ada to team 2");
    await act(async () => button("Discard").click());
    expect(moveStudents).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Draft discarded");
  });

  it("keeps Apply shut on a draft that names a student the class does not have", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Moves someone.",
      proposal: { kind: "seat", summary: "x", moves: [{ student: "s99", toTeam: "t1", toNewTeam: null }], renames: [], unresolved: [] },
    });
    mount();
    await ask("Move Zed to team 1");
    expect(host.textContent).toContain("Can't apply this draft");
    expect(button("Apply")).toBeUndefined();
  });

  it("hands a class list to the importer as the file it expects", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "Two students on Team 1.",
      proposal: {
        kind: "import",
        summary: "x",
        rows: [
          { name: "Ada Lovelace", email: "ada@x.edu", team: 1 },
          { name: "Mary Jackson", email: null, team: 1 },
        ],
      },
    });
    mount();
    await ask("Team 1: Ada, Mary Jackson");
    expect(onImport).toHaveBeenCalledWith("name,email,team\nAda Lovelace,ada@x.edu,1\nMary Jackson,,1", IMPORT_SOURCE);
    expect(host.textContent).toContain("Opened in the importer");
  });

  it("holds back a list carrying an address she never wrote, and names it", async () => {
    askAssistant.mockResolvedValue({
      kind: "proposal",
      text: "One student on Team 1.",
      proposal: { kind: "import", summary: "x", rows: [{ name: "Mary Jackson", email: "mjackson@x.edu", team: 1 }] },
    });
    mount();
    await ask("Team 1: Mary Jackson, mjacksen@x.edu");
    expect(onImport).not.toHaveBeenCalled();
    expect(host.textContent).toContain("not in what you sent: mjackson@x.edu");
    // Still hers to send on, once she has looked.
    await act(async () => button("Open in the importer anyway").click());
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("shows a failed request in place of an answer, and leaves it out of the next one's history", async () => {
    askAssistant.mockRejectedValueOnce(new Error("The assistant is busy right now. Try again in a minute."));
    askAssistant.mockResolvedValueOnce({ kind: "message", text: `${ada.name} is on Team 1.` });
    mount();
    await ask("Where is Ada?");
    expect(host.querySelector("[role=alert]")?.textContent).toMatch(/busy/);
    await ask("Where is Ada?");
    const [second] = askAssistant.mock.calls[1] as [{ history: { role: string; text: string }[] }];
    expect(second.history).toEqual([{ role: "user", text: "Where is Ada?" }]);
    expect(host.textContent).toContain("Ada Lovelace is on Team 1.");
  });
});
