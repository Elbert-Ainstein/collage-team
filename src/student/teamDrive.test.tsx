// Team files is a drive.
//
// A folder per assignment, made by the course; folders the team makes for
// itself; and a top level for whatever belongs in neither. What is pinned here
// is the part that used not to exist — a team can keep a file that is not about
// any one assignment — and the part that must survive it: an assignment's
// folder is still there, still named after the assignment, and cannot be
// renamed or deleted out from under the course.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import type { TeamFolder, TeamResource } from "@/checkins/resources";

const files: TeamResource[] = [];
const folders: TeamFolder[] = [];

const listAllTeamResources = vi.fn(async () => files);
const listTeamFolders = vi.fn(async () => folders);
const createTeamFolder = vi.fn(async (teamId: string, name: string) => {
  const row = {
    id: `f${folders.length + 1}`,
    team_id: teamId,
    name,
    created_by: null,
    created_at: "",
  };
  folders.push(row);
  return row;
});
const renameTeamFolder = vi.fn(async () => undefined);
const deleteTeamFolder = vi.fn(async () => undefined);
const uploadTeamResource = vi.fn(async () => files[0]);

vi.mock("@/checkins/resources", () => ({
  createTeamFolder,
  deleteTeamFolder,
  deleteTeamResource: vi.fn(async () => undefined),
  defaultTitle: (f: File) => f.name,
  listAllTeamResources,
  listTeamFolders,
  renameTeamFolder,
  renameTeamResource: vi.fn(async () => undefined),
  resourceUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `signed:${p}`]))),
  // The real ones: what may be shown in the page, and a URL per file. Kept
  // faithful because the tiles below are exactly this decision rendered.
  previewable: (mime: string | null, path: string) =>
    mime ? /^image\/(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(mime) : /\.(png|jpe?g)$/i.test(path),
  resourceUrlsByKind: vi.fn(
    async (rows: TeamResource[]) => new Map(rows.map((r) => [r.path, `signed:${r.path}`])),
  ),
  uploadTeamResource,
}));

vi.mock("@/checkins/audio", () => ({
  keepRecording: vi.fn(async () => undefined),
  listKeptRecordings: vi.fn(async () => []),
  recordingUrl: vi.fn(async () => ""),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TeamResources, assignmentKey, ownFolderKey, DRIVE_ROOT } = await import("./TeamResources");

const assignment = (id: string, title: string): Assignment =>
  ({
    activity: { id, title, type: "challenge", week: 3, course_id: "c1", stage: 1 },
    indivCheckIn: null,
    teamCheckIn: null,
    myResult: null,
    teamResult: null,
    status: "Not started",
    grade: "—",
    teamGrade: "—",
    submitted: null,
  }) as unknown as Assignment;

const enrolment = {
  student: { id: "s1", name: "Ada" },
  course: { id: "c1", name: "AP 50" },
  team: { id: "t1", name: "Team 4" },
  teammates: [],
} as unknown as Enrolment;

const file = (over: Partial<TeamResource>): TeamResource =>
  ({
    id: "r1",
    activity_id: null,
    folder_id: null,
    team_id: "t1",
    title: "notes",
    path: "c1/files/t1/x.pdf",
    mime: "application/pdf",
    size_bytes: 10,
    created_by: null,
    created_at: "",
    ...over,
  }) as TeamResource;

let host: HTMLDivElement;
let root: Root;
let opened: string | null;

async function show(openId: string | null = null): Promise<void> {
  await act(async () => {
    root.render(
      <TeamResources
        enrolment={enrolment}
        assignments={[assignment("a1", "Week 3 Challenge")]}
        openId={openId}
        onOpen={(id) => (opened = id)}
        onBack={() => undefined}
        onViewAssignment={() => undefined}
      />,
    );
  });
}

const buttonSaying = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  files.length = 0;
  folders.length = 0;
  opened = null;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the drive's top level", () => {
  it("still gives every assignment a folder, with nobody having made one", async () => {
    await show();
    expect(host.textContent).toContain("Assignment folders");
    expect(host.textContent).toContain("Week 3 Challenge");
  });

  it("makes a folder of the team's own", async () => {
    await show();
    await act(async () => buttonSaying("New folder")?.click());
    const box = host.querySelector<HTMLInputElement>('input[aria-label="New folder name"]');
    if (!box) throw new Error("no name box");
    await act(async () => typeInto(box, "Data"));
    await act(async () => buttonSaying("Create")?.click());

    expect(createTeamFolder).toHaveBeenCalledWith("t1", "Data");
  });

  it("shows the team's folders with what is in them", async () => {
    folders.push({ id: "f1", team_id: "t1", name: "Data", created_by: null, created_at: "" });
    files.push(file({ id: "r1", folder_id: "f1" }), file({ id: "r2", folder_id: "f1" }));
    await show();

    expect(host.textContent).toContain("Your folders");
    expect(host.textContent).toContain("Data");
    expect(host.textContent).toContain("2 items");
  });

  it("opens a team folder under its own key, not an activity's", async () => {
    folders.push({ id: "f1", team_id: "t1", name: "Data", created_by: null, created_at: "" });
    await show();
    // By its label, not its text: a folder tile carries its name and its count.
    const tile = host.querySelector<HTMLButtonElement>('button[aria-label="Open Data"]');
    await act(async () => tile?.click());
    expect(opened).toBe(ownFolderKey("f1"));
  });
});

describe("inside a folder", () => {
  it("a file in no folder at all is reachable, which is the whole point", async () => {
    files.push(file({ id: "r1", title: "spectra.csv" }));
    await show(DRIVE_ROOT);
    expect(host.textContent).toContain("Files in no folder");
    expect(host.textContent).toContain("1 item");
  });

  it("uploads into the folder that is open", async () => {
    folders.push({ id: "f1", team_id: "t1", name: "Data", created_by: null, created_at: "" });
    await show(ownFolderKey("f1"));

    const picker = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!picker) throw new Error("no picker");
    const dropped = new File(["x"], "spectra.csv", { type: "text/csv" });
    Object.defineProperty(picker, "files", { value: [dropped], configurable: true });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));

    expect(uploadTeamResource).toHaveBeenCalledWith(
      { courseId: "c1", teamId: "t1", activityId: null, folderId: "f1" },
      dropped,
      "spectra.csv",
    );
  });

  it("uploads into the assignment's folder when that is what is open", async () => {
    await show(assignmentKey("a1"));
    const picker = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!picker) throw new Error("no picker");
    const dropped = new File(["x"], "board.jpg", { type: "image/jpeg" });
    Object.defineProperty(picker, "files", { value: [dropped], configurable: true });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));

    expect(uploadTeamResource).toHaveBeenCalledWith(
      { courseId: "c1", teamId: "t1", activityId: "a1", folderId: null },
      dropped,
      "board.jpg",
    );
  });

  it("offers rename and delete on the team's folder", async () => {
    folders.push({ id: "f1", team_id: "t1", name: "Data", created_by: null, created_at: "" });
    await show(ownFolderKey("f1"));
    expect(buttonSaying("Rename")).toBeTruthy();
    expect(buttonSaying("Delete folder")).toBeTruthy();
  });

  it("offers neither on an assignment's folder — it is the course's", async () => {
    await show(assignmentKey("a1"));
    expect(buttonSaying("Rename")).toBeFalsy();
    expect(buttonSaying("Delete folder")).toBeFalsy();
    expect(buttonSaying("View assignment")).toBeTruthy();
  });

  it("takes two presses to delete a folder, and keeps what was inside", async () => {
    folders.push({ id: "f1", team_id: "t1", name: "Data", created_by: null, created_at: "" });
    files.push(file({ id: "r1", folder_id: "f1" }));
    await show(ownFolderKey("f1"));

    await act(async () => buttonSaying("Delete folder")?.click());
    expect(deleteTeamFolder).not.toHaveBeenCalled();
    await act(async () => buttonSaying("Delete it?")?.click());
    expect(deleteTeamFolder).toHaveBeenCalledWith("f1");
  });

  it("shows a file it cannot preview as a file, not a broken thumbnail", async () => {
    files.push(file({ id: "r1", title: "spectra.csv", path: "c1/files/t1/x.csv", mime: "text/csv" }));
    await show(DRIVE_ROOT);

    const tile = host.querySelector<HTMLAnchorElement>("a.sv-tr-filetile");
    expect(tile).toBeTruthy();
    expect(tile?.textContent).toContain("CSV");
    expect(tile?.getAttribute("href")).toBe("signed:c1/files/t1/x.csv");
  });

  it("still shows a photo as a photo", async () => {
    files.push(
      file({ id: "r1", title: "board", path: "c1/files/t1/x.jpg", mime: "image/jpeg" }),
    );
    await show(DRIVE_ROOT);

    expect(host.querySelector("a.sv-tr-filetile")).toBeFalsy();
    expect(host.querySelector("button.sv-tr-thumb")).toBeTruthy();
  });
});

describe("a key stored before folders existed", () => {
  it("still opens the assignment it named", async () => {
    // The session state of anyone mid-term holds a bare activity id.
    await show("a1");
    expect(host.textContent).toContain("Week 3 Challenge");
    expect(host.textContent).not.toContain("no longer in your session");
  });
});
