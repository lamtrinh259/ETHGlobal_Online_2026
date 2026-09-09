import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "@/app/Modal";
import { __scrollLockHolders } from "@/app/useBodyScrollLock";

describe("Modal", () => {
  it("is a dialog, closes on Escape and on the backdrop, and locks the page behind it", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="Attest tim@peeramid.xyz" onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    expect(screen.getByRole("dialog", { name: "Attest tim@peeramid.xyz" })).toBeVisible();
    expect(__scrollLockHolders()).toBe(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);

    // A click inside must not dismiss the work in progress.
    fireEvent.click(screen.getByText("body"));
    expect(onClose).toHaveBeenCalledTimes(2);

    unmount();
    expect(__scrollLockHolders()).toBe(0);
  });
});
