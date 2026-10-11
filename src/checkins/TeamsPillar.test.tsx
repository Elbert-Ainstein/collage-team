// The team set builder: a new set is a new arrangement.
//
// Kelly's feedback, in order: "+ New set" re-copied set 1 (it auto-formed the
// roster into teams of 4, which looked exactly like the set she had) and then
// everything else carried on editing set 1. A new set now starts blank — or, on
// purpose, as a copy — is called New Set, can be renamed, and the class moves
// onto it only when she says so.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Student, TeamSet, TeamWithMembers } from "./types";

const set = (id: string, name: string | null, created: string): TeamSet => ({
  id,
  course_id: "c1",
  activity_id: null,
  name,
  team_size: 4,
  locked: false,
  created_at: created,
});
const student = (n: number): Student => ({
  id: `s${n}`,
  course_id: "c1",
  name: `Student ${n}`,
  email: null,
  avatar_tint: null,
  position: n,
  created_at: "",
});
const roster = [1, 2, 3, 4].map(student);

let sets: TeamSet[] = [];
const teamsOf: Record<string, TeamWithMembers[]> = {};
const listTeamSets = vi.fn(async () => sets);
const listTeams = vi.fn(async (id: string) => teamsOf[id] ?? []);
const createTeamSet = vi.fn(async (input: { name?: string }) => {
  const made = set("made", input.name ?? null, "2026-10-09");
  sets = [...sets, made];
  return made;
});
const createTeam = vi.fn(async (setId: string, name: string, position: number) => ({
  id: `${setId}-${name}`,
  team_set_id: setId,
  name,
  position,
  created_at: "",
}));
const moveStudents = vi.fn(async () => undefined);
const autoFormTeams = vi.fn(async () => undefined);
const setCurrentTeamSet = vi.fn(async () => undefined);
const renameTeamSet = vi.fn(async () => undefined);

vi.mock("./data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./data")>();
  return {
    ...real,
    listTeamSets,
    listTeams,
    createTeamSet,
    createTeam,
    moveStudents,
    autoFormTeams,
    setCurrentTeamSet,
    renameTeamSet,
    countOneTeamResults: vi.fn(async () => 0),
    countTeamResults: vi.fn(async () => 0),
    deleteTeam: vi.fn(async () => undefined),
    deleteTeamSet: vi.fn(async () => undefined),
    renameTeam: vi.fn(async () => undefined),
    setTeamSetLocked: vi.fn(async () => undefined),
    setTeamSetSize: vi.fn(async () => undefined),
  };
});
vi.mock("./purge", () => ({
  deleteTeamResourceObjects: vi.fn(async () => undefined),
  deleteTeamStorage: vi.fn(async () => undefined),
}));
vi.mock("./resources", () => ({ countResourcesForTeams: vi.fn(async () => 0) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TeamsPillar } = await import("./TeamsPillar");

let host: HTMLDivElement;
let root: Root;
const refresh = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  sets = [set("fall", "Fall teams", "2026-09-01")];
  teamsOf.fall = [
    { id: "t1", team_set_id: "fall", name: "Team 1", position: 0, created_at: "", members: [roster[0], roster[1]] },
    { id: "t2", team_set_id: "fall", name: "Team 2", position: 1, created_at: "", members: [roster[2], roster[3]] },
  ];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(currentSetId: string | null = "fall") {
  await act(async () => {
    root.render(
      <TeamsPillar courseId="c1" roster={roster} activities={[]} refresh={refresh} currentSetId={currentSetId} />,
    );
  });
}

const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
const pills = () => Array.from(host.querySelectorAll(".t-pill")).map((p) => p.textContent);
const click = (el: HTMLElement) => act(async () => el.click());

describe("TeamsPillar · sets", () => {
  it("opens on the set in use, and says it is the one in use", async () => {
    await mount();
    expect(pills()).toEqual(["Fall teams · in use", "+ New set"]);
    expect(host.textContent).toContain("In use.");
  });

  it("makes a new set blank by default, called New Set, without forming any teams or moving the class", async () => {
    await mount();
    await click(button("+ New set"));
    const name = host.querySelector<HTMLInputElement>('input[aria-label="New set name"]')!;
    expect(name.value).toBe("New Set");
    await click(button("Create set"));
    expect(createTeamSet).toHaveBeenCalledWith(expect.objectContaining({ name: "New Set" }));
    expect(autoFormTeams).not.toHaveBeenCalled();
    expect(createTeam).not.toHaveBeenCalled();
    expect(setCurrentTeamSet).not.toHaveBeenCalled();
    // On screen now, and plainly not the one in use.
    expect(pills()).toContain("New Set");
    expect(host.textContent).toContain("Not in use — the class is on Fall teams.");
  });

  it("can start as a copy — new team rows with the same people, never the old rows", async () => {
    await mount();
    await click(button("+ New set"));
    const copy = host.querySelectorAll<HTMLInputElement>('input[name="new-set-start"]')[1];
    await click(copy);
    await click(button("Create set"));
    expect(createTeam).toHaveBeenCalledWith("made", "Team 1", 0);
    expect(createTeam).toHaveBeenCalledWith("made", "Team 2", 1);
    expect(moveStudents).toHaveBeenCalledWith(["s1", "s2"], "made-Team 1", []);
    expect(moveStudents).toHaveBeenCalledWith(["s3", "s4"], "made-Team 2", []);
  });

  it("moves the class onto another set only once asked twice", async () => {
    sets = [...sets, set("spring", "Spring teams", "2026-10-01")];
    await mount();
    await click(Array.from(host.querySelectorAll<HTMLButtonElement>(".t-pill"))[1]);
    await click(button("Use these teams now"));
    expect(setCurrentTeamSet).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Check-ins already marked keep the teams they were marked with");
    await click(button("Switch the class"));
    expect(setCurrentTeamSet).toHaveBeenCalledWith("c1", "spring");
    expect(refresh).toHaveBeenCalled();
    expect(pills()).toEqual(["Fall teams", "Spring teams · in use", "+ New set"]);
  });

  it("renames the set on screen", async () => {
    await mount();
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Set name"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(name, "Weeks 1–5");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      name.focus();
      name.blur();
    });
    expect(renameTeamSet).toHaveBeenCalledWith("fall", "Weeks 1–5");
    expect(pills()[0]).toBe("Weeks 1–5 · in use");
  });

  it("will not delete the set in use while there is another", async () => {
    sets = [...sets, set("spring", "Spring teams", "2026-10-01")];
    await mount();
    await click(button("Delete set"));
    expect(host.textContent).toContain("This is the set the class is using. Use another set first");
  });
});
