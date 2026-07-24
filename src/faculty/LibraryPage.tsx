"use client";

import { Icon } from "@/components";

// Library is a separate product surface (a shared content/resource library) —
// out of scope for the Team Module pilot. Placeholder for now.
export function LibraryPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="font-serif text-[30px] font-semibold text-black/80">Library</h1>
        <p className="mt-1 text-sm text-muted-fg">A shared library of content and resources.</p>
      </div>
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-cream-100 p-7">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky/40 text-[#0369a1]">
          <Icon name="library_books" />
        </span>
        <div>
          <div className="font-semibold text-navy">Coming soon</div>
          <div className="mt-0.5 text-sm text-muted-fg">
            The Library is a separate surface and isn't part of this build yet.
          </div>
        </div>
      </div>
    </>
  );
}
