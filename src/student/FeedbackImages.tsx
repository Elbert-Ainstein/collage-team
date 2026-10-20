"use client";

// The images a marker attached to the comment on this work (0046).
//
// Only asked for once the grade is released — the database refuses earlier
// anyway, and asking would only turn that refusal into an error on screen.

import { useState } from "react";
import { feedbackImageLabel } from "@/checkins/feedbackImages";
import { FeedbackImageViewer } from "@/checkins/FeedbackImageViewer";
import { useFeedbackImages, type FeedbackImagesState } from "@/checkins/useFeedbackImages";

/** The released images on one result. Empty until released, and empty where 0046 is not run. */
export function useReleasedFeedbackImages(
  resultId: string | null | undefined,
  released: boolean,
): FeedbackImagesState {
  // A student has nothing to do about a failed thumbnail; an empty strip is the
  // honest result, not an alarm.
  return useFeedbackImages(resultId ? { resultId } : null, ignore, released);
}

function ignore(): void {}

export function FeedbackImageGrid({ state }: { state: FeedbackImagesState }): JSX.Element | null {
  const [open, setOpen] = useState<number | null>(null);
  const { images, urls, unavailable } = state;
  if (unavailable || !images.length) return null;

  return (
    <>
      <ul className="sv-fimg-grid" aria-label="Images from your instructor">
        {images.map((img, i) => {
          const url = urls.get(img.path);
          const label = feedbackImageLabel(img, i);
          return (
            <li key={img.id} className="sv-fimg">
              {url ? (
                <button type="button" className="sv-fimg-open" onClick={() => setOpen(i)} title={`Open ${label}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={label} />
                </button>
              ) : (
                <span className="sv-sub">Image</span>
              )}
            </li>
          );
        })}
      </ul>
      <FeedbackImageViewer state={state} open={open} onOpen={setOpen} />
    </>
  );
}
