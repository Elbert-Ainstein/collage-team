// Images on a grading comment (0046): what may be attached, where it is filed,
// and that a half-finished attach never leaves an object nobody can find.

import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn(async (): Promise<{ message: string } | null> => null);
const remove = vi.fn(async (): Promise<{ message: string } | null> => null);
const signedUrls = vi.fn(async () => ({ urls: new Map<string, string>(), error: null }));

vi.mock("./storage", () => ({ put, remove, signedUrls }));

let insertResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const inserted: unknown[] = [];
const deleted: string[] = [];
const calls: string[] = [];

vi.mock("@/lib/supabaseClient", () => ({
  isSupabaseConfigured: true,
  requireSupabase: () => ({
    from: () => ({
      insert: (row: unknown) => {
        inserted.push(row);
        calls.push("insert");
        return { select: async () => insertResult };
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          deleted.push(id);
          calls.push("row delete");
          return { error: null };
        },
      }),
    }),
  }),
}));

const {
  deleteFeedbackImage,
  feedbackImagePath,
  feedbackImageName,
  feedbackImageProblem,
  FeedbackImagesNotInstalledError,
  uploadFeedbackImage,
  FEEDBACK_IMAGE_MAX_BYTES,
} = await import("./feedbackImages");

const file = (name: string, type: string, size = 1000): File => ({ name, type, size }) as File;
const target = { courseId: "c1", activityId: "a1", resultId: "r1" };

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  deleted.length = 0;
  calls.length = 0;
  insertResult = {
    data: [{ id: "img1", result_id: "r1", path: "p", mime: "image/png", created_by: "u", created_at: "" }],
    error: null,
  };
});

describe("what can be attached", () => {
  it("takes the images every browser draws", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(feedbackImageProblem(file("a", type))).toBeNull();
    }
  });

  it("refuses HEIC with a way out, since the student's browser can't show it", () => {
    expect(feedbackImageProblem(file("IMG_1.HEIC", "image/heic"))).toMatch(/JPEG or PNG/);
  });

  it("refuses anything that isn't an image, SVG included", () => {
    expect(feedbackImageProblem(file("x.pdf", "application/pdf"))).toMatch(/PNG, JPEG/);
    expect(feedbackImageProblem(file("x.svg", "image/svg+xml"))).toMatch(/PNG, JPEG/);
  });

  it("refuses an image over the limit, before it is sent", async () => {
    const big = file("huge.png", "image/png", FEEDBACK_IMAGE_MAX_BYTES + 1);
    expect(feedbackImageProblem(big)).toMatch(/25 MB/);
    await expect(uploadFeedbackImage(target, big)).rejects.toThrow(/25 MB/);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("where it is filed", () => {
  it("puts the result id third, which is what the storage policy reads", () => {
    expect(feedbackImagePath(target, "image/jpeg", "u1")).toBe("c1/a1/r1/u1.jpg");
    expect(feedbackImagePath(target, "image/png", "u2").split("/")[2]).toBe("r1");
  });
});

describe("what an image is called", () => {
  it("keeps the file's own name", () => {
    expect(feedbackImageName(file("Corrected FBD.png", "image/png"))).toBe("Corrected FBD.png");
  });

  it("calls a pasted screenshot a screenshot, not image.png", () => {
    expect(feedbackImageName(file("image.png", "image/png"))).toBe("Screenshot.png");
    expect(feedbackImageName(file("", "image/jpeg"))).toBe("Screenshot.jpg");
  });
});

describe("attaching", () => {
  it("uploads the object, then writes the row naming it", async () => {
    const image = await uploadFeedbackImage(target, file("shot.png", "image/png"));
    expect(put).toHaveBeenCalledTimes(1);
    const path = (put.mock.calls[0] as unknown as [string, string])[1];
    expect(path).toMatch(/^c1\/a1\/r1\/[0-9a-f-]+\.png$/);
    expect(inserted).toEqual([{ result_id: "r1", path, mime: "image/png", name: "shot.png" }]);
    expect(image.id).toBe("img1");
  });

  it("takes the object back out when the row can't be written", async () => {
    insertResult = { data: null, error: { message: "new row violates row-level security policy" } };
    await expect(uploadFeedbackImage(target, file("shot.png", "image/png"))).rejects.toThrow();
    const path = (put.mock.calls[0] as unknown as [string, string])[1];
    expect(remove).toHaveBeenCalledWith("feedback", [path]);
  });

  it("says to run 0046 when the table isn't there", async () => {
    insertResult = { data: null, error: { message: 'relation "feedback_images" does not exist' } };
    await expect(uploadFeedbackImage(target, file("s.png", "image/png"))).rejects.toBeInstanceOf(
      FeedbackImagesNotInstalledError,
    );
  });

  it("says to run 0046 when the bucket isn't there", async () => {
    put.mockResolvedValueOnce({ message: "Bucket not found" });
    await expect(uploadFeedbackImage(target, file("s.png", "image/png"))).rejects.toBeInstanceOf(
      FeedbackImagesNotInstalledError,
    );
    expect(inserted).toEqual([]);
  });
});

describe("removing", () => {
  it("removes the object before the row, so a failure leaves something findable", async () => {
    remove.mockImplementationOnce(async () => {
      calls.push("object delete");
      return null;
    });
    await deleteFeedbackImage({ id: "img1", path: "c1/a1/r1/x.png" });
    expect(calls).toEqual(["object delete", "row delete"]);
  });

  it("keeps the row when the object would not go", async () => {
    remove.mockResolvedValueOnce({ message: "permission denied" });
    await expect(deleteFeedbackImage({ id: "img1", path: "c1/a1/r1/x.png" })).rejects.toThrow(
      /permission/,
    );
    expect(deleted).toEqual([]);
  });
});
