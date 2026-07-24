"use client";

import { CourseContent } from "./CourseContent";

// Library — the catalog of created content (Lessons · Summatives). Activities are
// team-centric and live under the Team tab.
export function LibraryPage() {
  return (
    <>
      <div className="mb-1">
        <h1 className="font-serif text-[30px] font-semibold text-black/80">Library</h1>
        <p className="mt-1 text-sm text-muted-fg">Everything you've created for this course.</p>
      </div>
      <div className="mt-6">
        <CourseContent onlySubs={["lessons", "summatives"]} heading={null} />
      </div>
    </>
  );
}
