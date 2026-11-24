// The change-password dialog both sidebars open.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import type { PasswordChangeInput, PasswordChangeResult } from "./changePassword";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const inputs = () => [...host.querySelectorAll<HTMLInputElement>("input:not([hidden])")];
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);

/** React tracks input values itself, so a plain `.value =` never reaches onChange. */
function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fill(current: string, next: string, confirm: string) {
  const [a, b, c] = inputs();
  await act(async () => {
    type(a, current);
    type(b, next);
    type(c, confirm);
  });
}

async function submitForm() {
  await act(async () => {
    host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("ChangePasswordDialog", () => {
  it("opens on the current-password box, with three masked fields", async () => {
    await show(<ChangePasswordDialog skin="fv" onClose={() => {}} submit={vi.fn()} />);
    const boxes = inputs();
    expect(boxes.map((b) => b.type)).toEqual(["password", "password", "password"]);
    expect(boxes.map((b) => b.autocomplete)).toEqual(["current-password", "new-password", "new-password"]);
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Current password",
      "New password",
      "Confirm new password",
    ]);
    expect(document.activeElement).toBe(boxes[0]);
    expect(host.querySelector("[role=dialog]")?.getAttribute("aria-modal")).toBe("true");
  });

  it("sends what was typed and confirms when it worked", async () => {
    const submit = vi.fn(async (_: PasswordChangeInput): Promise<PasswordChangeResult> => ({ ok: true }));
    const onClose = vi.fn();
    await show(<ChangePasswordDialog skin="sv" onClose={onClose} submit={submit} />);
    await fill("old-secret", "new-secret", "new-secret");
    await submitForm();

    expect(submit).toHaveBeenCalledWith({ current: "old-secret", next: "new-secret", confirm: "new-secret" });
    expect(host.textContent).toContain("Password changed");
    expect(inputs()).toHaveLength(0);
    await act(async () => button("Done")?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the reason and marks the field it belongs to", async () => {
    const submit = vi.fn(
      async (): Promise<PasswordChangeResult> => ({
        ok: false,
        field: "current",
        error: "That isn't your current password.",
      }),
    );
    await show(<ChangePasswordDialog skin="fv" onClose={() => {}} submit={submit} />);
    await fill("wrong", "new-secret", "new-secret");
    await submitForm();

    expect(host.querySelector("[role=alert]")?.textContent).toBe("That isn't your current password.");
    const [current, next] = inputs();
    expect(current.getAttribute("aria-invalid")).toBe("true");
    expect(next.hasAttribute("aria-invalid")).toBe(false);

    // Typing into the flagged box clears the flag.
    await act(async () => type(current, "right"));
    expect(current.hasAttribute("aria-invalid")).toBe(false);
  });

  it("reveals one field at a time", async () => {
    await show(<ChangePasswordDialog skin="fv" onClose={() => {}} submit={vi.fn()} />);
    await act(async () => button("Show")?.click());
    expect(inputs().map((b) => b.type)).toEqual(["text", "password", "password"]);
  });

  it("closes on Escape, but not while a change is in flight", async () => {
    let finish: (r: PasswordChangeResult) => void = () => {};
    const submit = vi.fn(() => new Promise<PasswordChangeResult>((r) => (finish = r)));
    const onClose = vi.fn();
    await show(<ChangePasswordDialog skin="fv" onClose={onClose} submit={submit} />);
    const escape = () =>
      act(async () => {
        inputs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });

    await fill("old-secret", "new-secret", "new-secret");
    await submitForm();
    expect(button("Saving…")?.disabled).toBe(true);
    await escape();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finish({ ok: false, error: "Try again." }));
    await escape();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hands focus back to the button that opened it", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await show(<ChangePasswordDialog skin="fv" onClose={() => {}} submit={vi.fn()} />);
    expect(document.activeElement).not.toBe(opener);
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("gives a password manager the account it is updating", async () => {
    await show(
      <ChangePasswordDialog skin="sv" account="kelly@example.edu" onClose={() => {}} submit={vi.fn()} />,
    );
    const username = host.querySelector<HTMLInputElement>("input[autocomplete=username]");
    expect(username?.value).toBe("kelly@example.edu");
  });
});
