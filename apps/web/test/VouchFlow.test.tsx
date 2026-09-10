import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Published } from "@/app/AttestFlow";

/**
 * A reference is a title and a letter written in one form.
 *
 * The letter cannot be signed until the record exists — the text record hangs on the name the record
 * creates — so it is held while the record is published and written the moment that name is there.
 * What this covers is that it actually is: the letter was typed once, and asking for it again on a
 * second screen is the failure this replaced.
 */
const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";

const state = {
  letter: undefined as { name: string; letter: string } | undefined,
  letterFails: undefined as Error | undefined,
  stored: undefined as string | undefined,
  resolver: "0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7" as string | undefined,
};

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true }),
  useSignTypedData: () => ({ signTypedData: vi.fn(async () => ({ signature: "0x01" })) }),
  useWallets: () => ({
    wallets: [
      {
        walletClientType: "privy",
        address: WALLET,
        switchChain: vi.fn(async () => undefined),
        getEthereumProvider: vi.fn(async () => ({})),
      },
    ],
  }),
}));

vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    chainId: 11155111,
    multipass: WALLET,
    apiUrl: "http://api.test",
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

/** The record write is covered by AttestFlow's own tests; here it only has to finish. */
vi.mock("@/app/AttestFlow", () => ({
  // The sign-in gate renders an AttestFlow too, with no `onPublished`. Keying the button to that prop
  // is what keeps the test clicking the form rather than the gate.
  AttestFlow: ({ extra, onPublished }: { extra?: React.ReactNode; onPublished?: (p: Published) => void }) =>
    onPublished ? (
      <div>
        {extra}
        <button
          data-testid="fake-publish"
          onClick={() =>
            onPublished({ handle: "lam", domain: "~alice", txHash: "0x1", name: "lam.alice.ketsuban.eth" })
          }
        >
          publish
        </button>
      </div>
    ) : (
      <div data-testid="signin-gate" />
    ),
}));

vi.mock("@/lib/hooks", () => ({
  apiFor: () => ({
    storeLetter: vi.fn(async (text: string) => {
      state.stored = text;
      return { ref: `sha256:${"a".repeat(64)}` };
    }),
  }),
  useContracts: () => ({ data: { permissionedResolver: state.resolver } }),
  useWalletDashboard: () => ({
    isPending: false,
    // `linked` is what opens the statement stage: a writer must have attested the account they
    // worked from before their reference means anything.
    data: {
      names: [{ domain: "ketsuban", name: "lam", live: true, ensName: "lam.ketsuban.eth" }],
      links: [{ domain: "github.com", live: true, optedIn: false, ensName: null }],
      given: [],
      org: null,
      humanity: null,
      balance: "0",
    },
  }),
  useLetterWrite: () => ({
    mutateAsync: vi.fn(async (input: { name: string; letter: string }) => {
      if (state.letterFails) throw state.letterFails;
      state.letter = { name: input.name, letter: input.letter };
      return "0xtx";
    }),
  }),
}));

const { VouchFlow } = await import("@/app/vouch/[handle]/VouchFlow");

const publishWith = async (letter?: string) => {
  render(<VouchFlow candidate="alice" />);
  if (letter !== undefined) {
    fireEvent.change(screen.getByLabelText("letter"), { target: { value: letter } });
  }
  fireEvent.click(screen.getByTestId("fake-publish"));
};

describe("the letter written with the reference", () => {
  beforeEach(() => {
    state.letter = undefined;
    state.letterFails = undefined;
    state.stored = undefined;
    state.resolver = "0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7";
  });

  it("is written onto the name the record just created, without asking again", async () => {
    await publishWith("Ran the platform team while I was there.");
    await waitFor(() => expect(state.letter).toBeDefined());
    expect(state.letter).toEqual({
      name: "lam.alice.ketsuban.eth",
      letter: "Ran the platform team while I was there.",
    });
    expect(screen.getByTestId("letter-status")).toHaveTextContent("Letter written");
  });

  it("keeps a long letter by its hash first, so the record never names one nobody holds", async () => {
    const long = "x".repeat(700);
    await publishWith(long);
    await waitFor(() => expect(state.letter).toBeDefined());
    expect(state.stored).toBe(long);
    expect(state.letter?.letter).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("writes nothing when no letter was typed", async () => {
    await publishWith();
    await waitFor(() => expect(screen.getByTestId("vouch-done")).toBeInTheDocument());
    expect(state.letter).toBeUndefined();
    expect(screen.queryByTestId("letter-status")).toBeNull();
  });

  it("says the reference stands when only the letter failed", async () => {
    state.letterFails = new Error("user rejected the signature");
    await publishWith("something worth saying");
    await waitFor(() => expect(screen.getByTestId("letter-status")).toHaveTextContent("was not written"));
    // The reference itself is published, and the page must not imply otherwise.
    expect(screen.getByTestId("letter-status")).toHaveTextContent("user rejected the signature");
    expect(screen.getByTestId("vouch-done")).toBeInTheDocument();
  });

  it("says so when the deployment has no resolver to write a letter with", async () => {
    state.resolver = undefined;
    await publishWith("something worth saying");
    await waitFor(() =>
      expect(screen.getByTestId("letter-status")).toHaveTextContent("no permissioned resolver")
    );
  });
});
