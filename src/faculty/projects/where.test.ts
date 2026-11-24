import { describe, expect, it } from "vitest";
import { AT_LIST, projectSearch, readProjectWhere } from "./where";

describe("where the Projects tab is, on the URL", () => {
  it("reads every level", () => {
    expect(readProjectWhere("?s=projects")).toEqual(AT_LIST);
    expect(readProjectWhere("?s=projects&proj=p1")).toEqual({ ...AT_LIST, project: "p1" });
    expect(readProjectWhere("?s=projects&proj=p1&team=t1")).toEqual({ ...AT_LIST, project: "p1", team: "t1" });
    expect(readProjectWhere("?s=projects&proj=p1&team=t1&slot=2")).toEqual({
      project: "p1",
      team: "t1",
      slot: 2,
      edit: null,
    });
    expect(readProjectWhere("?s=projects&edit=new")).toEqual({ ...AT_LIST, edit: "new" });
    expect(readProjectWhere("?s=projects&proj=p1&edit=edit")).toEqual({ ...AT_LIST, project: "p1", edit: "edit" });
  });

  it("ignores what can't be meant", () => {
    // A team with no project, a slot with no team, a slot that isn't one.
    expect(readProjectWhere("?team=t1&slot=2")).toEqual(AT_LIST);
    expect(readProjectWhere("?proj=p1&slot=2")).toEqual({ ...AT_LIST, project: "p1" });
    expect(readProjectWhere("?proj=p1&team=t1&slot=0")).toEqual({ ...AT_LIST, project: "p1", team: "t1" });
    expect(readProjectWhere("?proj=p1&team=t1&slot=x")).toEqual({ ...AT_LIST, project: "p1", team: "t1" });
    // Editing an existing project needs one.
    expect(readProjectWhere("?edit=edit")).toEqual(AT_LIST);
  });

  it("writes its own keys and leaves everyone else's", () => {
    const at = { project: "p1", team: "t1", slot: 2, edit: null };
    expect(projectSearch("?s=projects&c=c1&join=ABC", at)).toBe(
      "?s=projects&c=c1&join=ABC&proj=p1&team=t1&slot=2",
    );
    expect(projectSearch("?s=projects&proj=p1&team=t1&slot=2", AT_LIST)).toBe("?s=projects");
    expect(projectSearch("", { ...AT_LIST, edit: "new" })).toBe("?edit=new");
  });
});
