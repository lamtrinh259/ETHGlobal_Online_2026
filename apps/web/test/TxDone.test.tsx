import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The end of every write this portal makes. A transaction that landed is the one thing a person cannot
 * check inside the app, so the confirmation carries the hash and a link to somewhere that is not us.
 */
const chain = { id: 11155111 };
vi.mock("@/app/providers", () => ({ useWebConfig: () => ({ chainId: chain.id }) }));

const { TxDone } = await import("@/app/TxDone");

const HASH = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  chain.id = 11155111;
});

describe("the confirmation a transaction ends in", () => {
  it("is a dialog with a check mark, the hash, and a link to the explorer", () => {
    render(<TxDone title="Published" hash={HASH} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Published" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Published" })).toBeVisible();
    expect(screen.getByTestId("tx-done-check")).toBeVisible();

    // The hash is the receipt: shown whole, and as code, because it is copied.
    const code = screen.getByTestId("tx-done").querySelector("code");
    expect(code).toHaveTextContent(HASH);

    const link = screen.getByTestId("tx-done-link");
    expect(link).toHaveAttribute("href", `https://sepolia.etherscan.io/tx/${HASH}`);
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(link).toHaveTextContent("View on explorer");
  });

  it("shows the hash alone on a chain nobody hosts an explorer for", () => {
    // A local anvil has nowhere to send anybody; a link into the void would be worse than none.
    chain.id = 31337;
    render(<TxDone title="Gas sent" hash={HASH} onClose={vi.fn()} />);
    expect(screen.queryByTestId("tx-done-link")).toBeNull();
    expect(screen.getByTestId("tx-done").querySelector("code")).toHaveTextContent(HASH);
  });

  it("closes back to the page, which is still there behind it", () => {
    const onClose = vi.fn();
    render(<TxDone title="Published" hash={HASH} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("carries whatever else the caller wants said about this write", () => {
    render(
      <TxDone title="Profile published" hash={HASH} onClose={vi.fn()}>
        <p>3 transactions, one per record.</p>
      </TxDone>
    );
    expect(screen.getByTestId("tx-done")).toHaveTextContent("3 transactions, one per record.");
  });
});
