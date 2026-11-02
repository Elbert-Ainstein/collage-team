// What a TF may do follows the course's switches. Release follows two (0055):
// grading, and whether TFs release their own grades.

import { describe, expect, it, vi } from "vitest";
import type { Course } from "@/checkins/types";

vi.mock("./facultyData", () => ({}));

const { capabilitiesFor } = await import("./FacultyApp");

const course = (over: Partial<Course> = {}): Course =>
  ({ id: "c1", tf_can_grade: true, tf_can_checkin: false, ...over }) as Course;

describe("release", () => {
  it("is the owner's always", () => {
    expect(capabilitiesFor(course({ tf_can_release: false }), true).release).toBe(true);
  });

  it("is a grading TF's when the course lets TFs release", () => {
    expect(capabilitiesFor(course({ tf_can_release: true }), false).release).toBe(true);
  });

  it("is not a TF's when the course sends grades for review", () => {
    expect(capabilitiesFor(course({ tf_can_release: false }), false).release).toBe(false);
  });

  it("is not a TF's on a database without 0055, which still holds them to review", () => {
    expect(capabilitiesFor(course(), false).release).toBe(false);
  });

  it("is not a TF's who cannot grade", () => {
    expect(capabilitiesFor(course({ tf_can_grade: false, tf_can_release: true }), false).release).toBe(false);
  });
});
