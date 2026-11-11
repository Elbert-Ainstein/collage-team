// GET /api/version — the build this deployment is.
//
// A tab compares it with the build it was loaded from (src/lib/newerBuild.ts)
// to find out it has been left behind by a deploy. Public and tiny: the id is
// a commit sha, which is already in every page this deployment serves.

import { BUILD_ID } from "@/lib/newerBuild";

// Asked fresh every time: a cached answer would be the old build's.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ build: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
