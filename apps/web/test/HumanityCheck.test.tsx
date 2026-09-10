import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * IDKit's own widget is World App's QR flow: a scan on a phone, and nothing a browser test can drive.
 * Standing in for it leaves exactly the part this repo owns — what is asked for, and what is done with
 * the answer — and asserts on the props the real widget reads, so a rename here still fails the test.
 */
const seen: Record<string, unknown>[] = [];
vi.mock("@worldcoin/idkit", () => ({
  proofOfHuman: (opts: { signal?: string }) => ({ preset: "proof_of_human", ...opts }),
  IDKitRequestWidget: (props: Record<string, unknown>) => {
    seen.push(props);
    return (
      <button
        data-testid="idkit-stub"
        onClick={async () => {
          // IDKit routes a throwing handleVerify to onError and never reaches onSuccess.
          try {
            await (props.handleVerify as (r: unknown) => Promise<void>)({ protocol_version: "3.0" });
            await (props.onSuccess as (r: unknown) => Promise<void>)({ protocol_version: "3.0" });
          } catch {
            /* the component says what went wrong itself */
          }
        }}
      >
        scan
      </button>
    );
  },
}));

const { HumanityCheck } = await import("@/app/me/HumanityCheck");

const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const challenge = {
  app_id: "app_ketsuban",
  action: "kju-humanity",
  environment: "production" as const,
  signal: WALLET.toLowerCase(),
  rp_context: {
    rp_id: "rp_ketsuban",
    nonce: "0x00ab",
    created_at: 1_800_000_000,
    expires_at: 1_800_000_300,
    signature: "0xsig",
  },
};

const api = () => ({
  humanityChallenge: vi.fn(async () => challenge),
  proveHumanity: vi.fn(async () => ({ level: "orb", until: "2026-10-08T09:14:22.000Z" })),
});

beforeEach(() => {
  seen.length = 0;
});

describe("the humanity check", () => {
  it("asks the server for the request before opening anything", async () => {
    // The proof request carries a signature only the server can make, so the widget cannot exist until
    // that round trip is done. Opening first and filling in the context later is the bug this catches:
    // World rejects an unsigned request and the person sees a dialog that never resolves.
    const a = api();
    render(<HumanityCheck api={a as never} wallet={WALLET} onVerified={vi.fn()} />);
    expect(seen).toHaveLength(0);

    fireEvent.click(screen.getByTestId("humanity-cta"));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(a.humanityChallenge).toHaveBeenCalledWith(WALLET);

    const props = seen[seen.length - 1];
    expect(props).toMatchObject({
      open: true,
      app_id: "app_ketsuban",
      action: "kju-humanity",
      rp_context: challenge.rp_context,
      environment: "production",
      // Both proof versions: an Orb-verified person who has not migrated to World ID 4.0 still has to
      // be able to prove it, which is what the legacy fallback is for.
      allow_legacy_proofs: true,
    });
    // The signal binds the proof to this wallet, and the server refuses one bound to anything else.
    expect(props.preset).toEqual({ preset: "proof_of_human", signal: WALLET.toLowerCase() });
  });

  it("sends the proof to our own server, not just to World", async () => {
    // World says the mathematics is sound. Only this deployment can say the nullifier is unspent and
    // write the record, so a widget wired to World alone would show a tick and change nothing.
    const a = api();
    const onVerified = vi.fn();
    render(<HumanityCheck api={a as never} wallet={WALLET} onVerified={onVerified} />);
    fireEvent.click(screen.getByTestId("humanity-cta"));
    await waitFor(() => expect(screen.queryByTestId("idkit-stub")).not.toBeNull());

    fireEvent.click(screen.getByTestId("idkit-stub"));
    await waitFor(() => expect(a.proveHumanity).toHaveBeenCalled());
    expect(a.proveHumanity).toHaveBeenCalledWith(WALLET, { protocol_version: "3.0" });
    // And the page is told, because the badge is read from the chain and has to be asked again.
    expect(onVerified).toHaveBeenCalled();
  });

  it("says why nothing happened when the check is unavailable", async () => {
    // An unconfigured deployment answers 501 here. A button that silently does nothing is the worst
    // version of that; the reason belongs on screen.
    const a = api();
    a.humanityChallenge = vi.fn(async () => {
      throw new Error("World ID not configured");
    });
    render(<HumanityCheck api={a as never} wallet={WALLET} onVerified={vi.fn()} />);
    fireEvent.click(screen.getByTestId("humanity-cta"));
    await waitFor(() => expect(screen.getByTestId("humanity-error")).toHaveTextContent(/not configured/i));
    // And no widget was mounted for a request that was never signed.
    expect(seen).toHaveLength(0);
  });

  it("reports a proof our own server refuses, rather than claiming success", async () => {
    // A replayed nullifier answers 409 here. The person has done the check and still has no record, so
    // saying so is the only honest end to the flow.
    const a = api();
    a.proveHumanity = vi.fn(async () => {
      throw new Error("that proof of humanity is already held by another account");
    });
    const onVerified = vi.fn();
    render(<HumanityCheck api={a as never} wallet={WALLET} onVerified={onVerified} />);
    fireEvent.click(screen.getByTestId("humanity-cta"));
    await waitFor(() => expect(screen.queryByTestId("idkit-stub")).not.toBeNull());
    fireEvent.click(screen.getByTestId("idkit-stub"));
    await waitFor(() =>
      expect(screen.getByTestId("humanity-error")).toHaveTextContent(/already held by another account/i)
    );
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("offers nothing without a wallet to bind the proof to", async () => {
    // The signal is the wallet. With none there is nothing to bind, and a proof bound to nothing would
    // be spendable on any account that got hold of it.
    render(<HumanityCheck api={api() as never} wallet={undefined} onVerified={vi.fn()} />);
    expect(screen.getByTestId("humanity-cta")).toBeDisabled();
  });
});
