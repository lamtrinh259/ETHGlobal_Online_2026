import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  /** Whether the deployment can check humanity at all; the fake writer never holds a proof. */
  checksHumanity: false,
  /** The accounts the fake writer has attested; one from GitHub unless a test says otherwise. */
  /** The fake writer's own name in the root domain; a test without one starts at the first step. */
  names: [{ domain: "ketsuban", name: "lam", live: true, ensName: "lam.ketsuban.eth" }] as {
    domain: string;
    name: string;
    live: boolean;
    ensName: string | null;
  }[],
  links: [{ domain: "github.com", live: true, optedIn: false, ensName: null }] as {
    domain: string;
    live: boolean;
    optedIn: boolean;
    ensName: string | null;
  }[],
};

const linksAsked: string[] = [];

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { id: "did:privy:x", github: { username: "bob" } } }),
  useLinkAccount: () => ({
    linkTwitter: () => linksAsked.push("x"),
    linkGithub: () => linksAsked.push("github"),
    linkDiscord: () => linksAsked.push("discord"),
    linkGoogle: () => linksAsked.push("google"),
    linkEmail: () => linksAsked.push("email"),
  }),
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
  AttestFlow: ({
    extra,
    onPublished,
    fixedDomain,
  }: {
    extra?: React.ReactNode;
    onPublished?: (p: Published) => void;
    fixedDomain?: string;
  }) =>
    onPublished ? (
      <div data-testid="attest" data-domain={fixedDomain ?? ""}>
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

vi.mock("@/app/me/HumanityCheck", () => ({
  HumanityCheck: ({ onVerified }: { onVerified: () => void }) => (
    <button data-testid="fake-human" onClick={onVerified}>
      selfie
    </button>
  ),
}));

vi.mock("@/lib/hooks", () => ({
  apiFor: () => ({
    storeLetter: vi.fn(async (text: string) => {
      state.stored = text;
      return { ref: `sha256:${"a".repeat(64)}` };
    }),
  }),
  useContracts: () => ({ data: { permissionedResolver: state.resolver, humanity: state.checksHumanity } }),
  // What the candidate opened to whoever holds the invitation; none of it, here.
  useDisclosures: () => ({ data: undefined, isPending: false }),
  useWalletDashboard: () => ({
    isPending: false,
    // `linked` is what opens the statement stage: a writer must have attested the account they
    // worked from before their reference means anything.
    data: {
      names: state.names,
      links: state.links,
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

describe("what onboarding still needs", () => {
  const invite = {
    requires: ["github.com", "x.com"],
    candidate: "alice",
    code: "c",
    expires: 0,
    signature: "0x",
  } as unknown as import("@ketsuban/registrar").SignedInvite;
  afterEach(() => {
    state.links = [{ domain: "github.com", live: true, optedIn: false, ensName: null }];
    state.checksHumanity = false;
  });

  it("says which accounts the invitation asks for, attests the first missing one in place, and the Selfie Check", async () => {
    state.links = [];
    state.checksHumanity = true;
    render(<VouchFlow candidate="alice" invite={invite} inviteCode="c" />);
    await waitFor(() => expect(screen.getByTestId("onboarding-gate")).toBeInTheDocument());
    const gate = screen.getByTestId("onboarding-gate");
    expect(gate.textContent).toContain("github.com and x.com");
    expect(gate.textContent).toContain("stays masked");
    expect(screen.getByTestId("onboarding-steps").querySelectorAll("li.todo")).toHaveLength(2);
    expect(screen.getByTestId("attest")).toHaveAttribute("data-domain", "github.com");
    expect(screen.getByTestId("fake-human")).toBeInTheDocument();
    expect(gate.querySelector("a[href^='/me']")).toBeNull();
  });

  it("tells a writer signed in as somebody else that the invitation is not theirs, and links nothing", async () => {
    state.links = [{ domain: "github.com", live: true, optedIn: false, ensName: null }];
    const forLam = { ...invite, requires: ["github.com/lam"] } as typeof invite;
    render(<VouchFlow candidate="alice" invite={forLam} inviteCode="c" />);
    await waitFor(() => expect(screen.getByTestId("onboarding-gate")).toBeInTheDocument());
    expect(screen.getByTestId("not-you").textContent).toContain("for @lam on github.com");
    expect(screen.getByTestId("not-you").textContent).toContain("@bob");
    expect(screen.queryByTestId("attest")).toBeNull();
    expect(screen.getByTestId("onboarding-steps").textContent).toContain("github.com as @lam");
  });

  it("puts the link button on the row that says the account is missing", async () => {
    state.links = [];
    linksAsked.length = 0;
    const mail = { ...invite, requires: ["peersky.xyz", "x.com", "github.com"] } as typeof invite;
    render(<VouchFlow candidate="alice" invite={mail} inviteCode="c" />);
    await waitFor(() => expect(screen.getByTestId("onboarding-gate")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("link-peersky.xyz"));
    fireEvent.click(screen.getByTestId("link-x.com"));
    expect(linksAsked).toEqual(["email", "x"]);
    expect(screen.getByTestId("link-peersky.xyz").textContent).toBe("Link an email address");
    // GitHub is linked already (the fixture is bob there): nothing to link, only to sign below.
    expect(screen.queryByTestId("link-github.com")).toBeNull();
    expect(screen.getByTestId("onboarding-steps").textContent).toContain("github.com — linked; sign and publish below");
  });

  it("keeps the confirmation on screen after the record lands, and opens the next step under it", async () => {
    state.links = [];
    state.checksHumanity = true;
    render(<VouchFlow candidate="alice" invite={{ ...invite, requires: ["x.com"] } as typeof invite} inviteCode="c" />);
    await waitFor(() => expect(screen.getByTestId("onboarding-gate")).toBeInTheDocument());
    expect(screen.getByTestId("attest")).toHaveAttribute("data-domain", "x.com");
    // The record lands and the dashboard lists the link.
    state.links = [{ domain: "x.com", live: true, optedIn: false, ensName: null }];
    fireEvent.click(screen.getByTestId("fake-publish"));
    await waitFor(() => expect(screen.getByTestId("onboarding-steps").textContent).toContain("x.com — attested"));
    // Same card, same form still there with what it showed; the Selfie Check step is below it, not instead.
    expect(screen.getByTestId("attest")).toHaveAttribute("data-domain", "x.com");
    expect(screen.getByTestId("step-accounts").textContent).toContain("✓");
    expect(screen.getByTestId("humanity-gate")).toHaveAttribute("open");
    expect(screen.getByTestId("fake-human")).toBeInTheDocument();
  });

  it("moves on to the next required account once one is attested", async () => {
    state.links = [{ domain: "github.com", live: true, optedIn: false, ensName: null }];
    render(<VouchFlow candidate="alice" invite={invite} inviteCode="c" />);
    await waitFor(() => expect(screen.getByTestId("onboarding-gate")).toBeInTheDocument());
    expect(screen.getByTestId("onboarding-steps").querySelectorAll("li.done")).toHaveLength(1);
    expect(screen.getByTestId("attest")).toHaveAttribute("data-domain", "x.com");
  });

  it("asks for nothing when the invitation named nothing: straight to the statement", async () => {
    state.links = [];
    render(<VouchFlow candidate="alice" />);
    await waitFor(() => expect(screen.getByTestId("fake-publish")).toBeInTheDocument());
    expect(screen.queryByTestId("onboarding-gate")).toBeNull();
  });
});

describe("your own name comes first", () => {
  afterEach(() => {
    state.names = [{ domain: "ketsuban", name: "lam", live: true, ensName: "lam.ketsuban.eth" }];
  });

  it("claims the writer's name as the first step, and never asks for a handle on the statement", async () => {
    state.names = [];
    render(<VouchFlow candidate="alice" />);
    await waitFor(() => expect(screen.getByTestId("onboarding-gate")).toBeInTheDocument());
    expect(screen.getByTestId("step-name").textContent).toContain("Your name");
    expect(screen.getByTestId("attest")).toHaveAttribute("data-domain", "ketsuban");
    // The name lands; the step folds with its confirmation still inside, and the statement is next.
    state.names = [{ domain: "ketsuban", name: "lam", live: true, ensName: "lam.ketsuban.eth" }];
    fireEvent.click(screen.getByTestId("fake-publish"));
    await waitFor(() => expect(screen.getByTestId("step-name").textContent).toContain("✓"));
    expect(screen.getAllByTestId("attest")[0]).toHaveAttribute("data-domain", "ketsuban");
    expect(screen.getByText(/lam\.alice\.ketsuban\.eth/)).toBeInTheDocument();
  });
});

describe("one real person writes it", () => {
  it("sends a writer with no proof to the Selfie Check before asking for a statement", async () => {
    state.checksHumanity = true;
    try {
      render(<VouchFlow candidate="alice" />);
      await waitFor(() => expect(screen.getByTestId("humanity-gate")).toBeInTheDocument());
      // The check is done here, not on a page they are sent to and back from.
      expect(screen.getByTestId("humanity-gate").querySelector("[data-testid='fake-human']")).not.toBeNull();
      expect(screen.getByTestId("humanity-gate").querySelector("a[href^='/me']")).toBeNull();
    } finally {
      state.checksHumanity = false;
    }
  });
});
