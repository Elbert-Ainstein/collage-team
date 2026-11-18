"use client";

// A textarea that grows with what's written in it, so a long reflection is
// read whole while it's written rather than through a three-line slot. It
// counts characters only near the limit, where the count is news.

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** The most characters allowed. */
  max: number;
}

export function AutoTextarea({ value, onChange, max, className, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  const near = value.length >= max * 0.9;
  return (
    <>
      <textarea
        ref={ref}
        className={`${className ?? ""} te-auto`}
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      {near ? (
        <span className="te-count" aria-live="polite">
          {value.length.toLocaleString()} / {max.toLocaleString()}
        </span>
      ) : null}
    </>
  );
}
