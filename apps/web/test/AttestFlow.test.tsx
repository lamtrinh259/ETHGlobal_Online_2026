import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

/**
 * AttestFlow is mostly wallet plumbing, so these tests cover the one thing a reader of the screen
 * depends on: what it claims after a publish. Saying "signed" when the relay refused the record is the
 * difference between a stale list and a lie.
 */
const privy = {
  ready: true,
  authenticated: true,
  login: vi.fn(),
  user: { id: "did:privy:x" },
};
const wallets = [{ walletClientType: "privy", address: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a" }];

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => privy,
  useWallets: () => ({ wallets }),
  useIdentityToken: () => ({ identityToken: "token" }),
  useSignTypedData: () => ({ signTypedData: vi.fn(async () => ({ signature: "0xsig" })) }),
  useLinkAccount: (opts?: {
    onSuccess?: (r: { linkMethod: string; linkedAccount?: { address?: string } }) => void;
    onError?: (error: string, details: { linkMethod?: string }) => void;
  }) => {
    linking.onSuccess = opts?.onSuccess;
    linking.onError = opts?.onError;
    return {
      linkTwitter: vi.fn(),
      linkGithub: linking.linkGithub,
      linkDiscord: vi.fn(),
      linkGoogle: vi.fn(),
      linkLinkedIn: vi.fn(),
      linkEmail: vi.fn(),
    };
  },
}));
const linking = {
  onSuccess: undefined as
    undefined | ((r: { linkMethod: string; linkedAccount?: { address?: string } }) => void),
  onError: undefined as undefined | ((error: string, details: { linkMethod?: string }) => void),
  linkGithub: vi.fn(),
};

const state = {
  delivered: undefined as unknown,
  deliverError: undefined as Error | undefined,
  txHash: undefined as string | undefined,
  attestData: undefined as object | undefined,
  /** What this deployment already holds; anything else is built while the first account is attested */
  mounted: ["ketsuban", "kju-is", "x.com"] as string[],
  cachedNonce: { exists: false, next: 1n, ready: true, reason: null } as
    { exists: boolean; next: bigint; ready: boolean; reason: string | null } | undefined,
  freshNonce: { exists: false, next: 1n, ready: true, reason: null } as
    { exists: boolean; next: bigint; ready: boolean; reason: string | null } | undefined,
  wire: undefined as { intent?: { nonce?: string } } | undefined,
  attestError: undefined as Error | undefined,
};

vi.mock("@/lib/hooks", () => ({
  apiFor: () => ({}),
  useContracts: () => ({ data: { instances: state.mounted.map((domain) => ({ domain })) } }),
  useNonce: () => ({
    // What the page read when it loaded, which may no longer be what the chain holds.
    data: state.cachedNonce,
    refetch: vi.fn(async () => ({ data: state.freshNonce, error: undefined })),
  }),
  useNameStatus: () => ({ data: undefined }),
  useAttest: () => ({
    data: state.attestData,
    error: state.attestError,
    isPending: false,
    reset: vi.fn(),
    mutateAsync: vi.fn(async (wire: { intent?: { nonce?: string } }) => {
      state.wire = wire;
      return { record: {}, signature: "0x01", viewCode: null };
    }),
  }),
  useDeliver: () => ({
    data: state.txHash ? { txHash: state.txHash } : undefined,
    error: state.deliverError,
    isPending: false,
    reset: vi.fn(),
    mutateAsync: vi.fn(async (input: unknown) => {
      state.delivered = input;
      return {
        txHash: "0xdead",
        letterWritten: typeof input === "object" && !!input && "description" in input,
      };
    }),
  }),
}));

// The view key lives in the browser's storage, which this file has none of; the flow only needs it to
// exist, and what it holds is covered where it is created.
vi.mock("@/lib/keys", () => ({
  loadOrCreateViewKey: () => ({ publicKey: `0x02${"11".repeat(32)}`, privateKey: `0x${"22".repeat(32)}` }),
  openViewCode: () => `0x${"33".repeat(32)}`,
  saveViewCode: vi.fn(),
}));

vi.mock("@/app/providers", () => ({
  useWebConfig: () => ({
    chainId: 11155111,
    multipass: "0x418F82fd0014a4CA402F145978bfaF0555a9cA06",
    nameDomains: ["ketsuban", "kju-is"],
    instances: [
      { domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" },
      { domain: "kju-is", parentName: "kju-is.ketsuban.eth", parentLabel: "kju-is" },
    ],
    apiUrl: "http://api.test",
    attestUrl: "http://api.test/v1/attest",
  }),
}));

const record = {
  name: `0x${"61".repeat(32)}`,
  id: `0x${"00".repeat(32)}`,
  domainName: `0x${"67".repeat(32)}`,
  validUntil: "1791531339",
  nonce: "1",
  wallet: wallets[0].address,
  payload: `0x${"00".repeat(32)}`,
};

const { AttestFlow } = await import("@/app/AttestFlow");

beforeEach(() => {
  state.deliverError = undefined;
  state.txHash = undefined;
  state.attestData = undefined;
  state.cachedNonce = { exists: false, next: 1n, ready: true, reason: null };
  state.freshNonce = { exists: false, next: 1n, ready: true, reason: null };
  state.wire = undefined;
  state.attestError = undefined;
});

describe("AttestFlow fields", () => {
  it("says when publishing also builds the namespace, and when it does not", () => {
    // The first account at a mail host mounts its levels, instance and mirror: several deployments and
    // about a minute, which is worth knowing before the button is pressed rather than after.
    const { container: fresh } = render(<AttestFlow fixedDomain="peeramid.xyz" />);
    expect(fresh.querySelector("[data-testid=mounting-note]")?.textContent).toContain(
      "first to attest an account at"
    );

    const { container: known } = render(<AttestFlow fixedDomain="x.com" />);
    expect(known.querySelector("[data-testid=mounting-note]")).toBeNull();

    // A flat domain is not a namespace to build, so it never says this either.
    const { container: flat } = render(<AttestFlow fixedDomain="ketsuban" />);
    expect(flat.querySelector("[data-testid=mounting-note]")).toBeNull();
  });

  it("asks for an answer in a subject instance and a vouch domain, never when claiming the root name", () => {
    const { container: root } = render(<AttestFlow fixedDomain="ketsuban" />);
    expect(root.querySelector("[aria-label=answer]")).toBeNull();
    expect(root.querySelector("[data-testid=answer-bytes]")).toBeNull();

    const { container: subject } = render(<AttestFlow fixedDomain="kju-is" />);
    expect(subject.querySelector("[aria-label=answer]")).not.toBeNull();

    const { container: vouch } = render(<AttestFlow fixedDomain="~alice" fixedHandle="bob" />);
    expect(vouch.querySelector("[aria-label=answer]")).not.toBeNull();
  });
});

describe("AttestFlow after signing", () => {
  it("says the relay refused it, and keeps the form so it can be retried", () => {
    state.attestData = { record, signature: "0xsig", viewCode: null };
    state.deliverError = new Error("invalidSignature: not the registrar");
    render(<AttestFlow fixedDomain="google" />);
    expect(screen.getByTestId("published")).toHaveTextContent("Signed, but not written");
    expect(screen.getByTestId("published")).toHaveTextContent("nothing changed on chain");
    expect(screen.getByTestId("publish")).toBeVisible();
  });

  it("confirms a real write and removes the form, so nothing invites a second one", () => {
    state.attestData = { record, signature: "0xsig", viewCode: null };
    state.txHash = `0x${"ab".repeat(32)}`;
    render(<AttestFlow fixedDomain="google" />);
    expect(screen.getByTestId("published")).toHaveTextContent("Published.");
    expect(screen.queryByTestId("publish")).toBeNull();
  });

  /**
   * The transaction is the one claim nobody can check inside this app, so it ends in a dialog naming
   * it — over the page, never instead of it: the view code underneath is what a masked writer loses if
   * the confirmation is swapped away.
   */
  it("ends in a modal with the hash and a link to the explorer, and says what was done", () => {
    state.attestData = { record, signature: "0xsig", viewCode: null };
    state.txHash = `0x${"ab".repeat(32)}`;
    render(<AttestFlow fixedDomain="google" doneTitle="Account attested" />);
    expect(screen.getByRole("dialog", { name: "Account attested" })).toBeVisible();
    expect(screen.getByTestId("tx-done-check")).toBeVisible();
    expect(screen.getByTestId("tx-done")).toHaveTextContent(state.txHash);
    expect(screen.getByTestId("tx-done-link")).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/tx/${state.txHash}`
    );
  });

  it("calls the write published when the caller says nothing else", () => {
    state.attestData = { record, signature: "0xsig", viewCode: null };
    state.txHash = `0x${"cd".repeat(32)}`;
    render(<AttestFlow fixedDomain="google" />);
    expect(screen.getByRole("dialog", { name: "Published" })).toBeVisible();
  });

  it("closes back to the confirmation on the page, which is still there", () => {
    state.attestData = { record, signature: "0xsig", viewCode: null };
    state.txHash = `0x${"ab".repeat(32)}`;
    render(<AttestFlow fixedDomain="google" doneTitle="Account attested" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("tx-done")).toBeNull();
    expect(screen.getByTestId("published")).toHaveTextContent("Published.");
  });

  it("says nothing landed when the relay refused it", () => {
    state.attestData = { record, signature: "0xsig", viewCode: null };
    state.deliverError = new Error("invalidSignature: not the registrar");
    render(<AttestFlow fixedDomain="google" doneTitle="Account attested" />);
    expect(screen.queryByTestId("tx-done")).toBeNull();
  });
});

describe("how much of a statement fits", () => {
  it("counts bytes and says bytes, because a name holds 31 of them and not 31 characters", async () => {
    // "café" is four characters and five bytes; an emoji is four bytes. A counter that says
    // "characters" tells someone they have room they do not have.
    render(<AttestFlow fixedDomain="~alice" answerLabel="Statement" />);
    const box = await screen.findByLabelText("answer");

    fireEvent.change(box, { target: { value: "cafe" } });
    expect(screen.getByTestId("answer-bytes")).toHaveTextContent("4/31 bytes");
    fireEvent.change(box, { target: { value: "café" } });
    expect(screen.getByTestId("answer-bytes")).toHaveTextContent("5/31 bytes");
    // The misleading claim was the limit itself: 31 bytes is not 31 characters.
    expect(screen.getByTestId("answer-bytes")).not.toHaveTextContent("/31 characters");

    // And when the two differ, it says why rather than leaving a wrong-looking number.
    expect(screen.getByTestId("answer-bytes")).toHaveTextContent(/4 characters/);
  });

  it("says plainly when a statement will not fit at all", async () => {
    render(<AttestFlow fixedDomain="~alice" answerLabel="Statement" />);
    const box = await screen.findByLabelText("answer");
    fireEvent.change(box, { target: { value: "x".repeat(32) } });
    expect(screen.getByTestId("answer-bytes")).toHaveTextContent(/too long/);
  });
});

/**
 * The nonce is the one value that cannot be reused: the chain refuses a record whose nonce has not
 * increased. A page that read it once and then published twice — or whose first write timed out in the
 * browser and landed anyway — signs the second intent with a number the chain has already seen, and
 * spends a person's signature on a request that was doomed before they gave it.
 */
describe("the nonce an intent carries", () => {
  const publish = async () => {
    render(<AttestFlow fixedDomain="~alice" fixedHandle="peersky" />);
    fireEvent.click(screen.getByTestId("publish"));
    await waitFor(() => {
      const alert = screen.queryByRole("alert");
      if (alert) throw new Error(`publish refused: ${alert.textContent}`);
      expect(state.wire).toBeDefined();
    });
  };

  it("is the one the chain holds now, not the one the page loaded with", async () => {
    // The record was written since this page read its nonce, which is exactly the case that failed.
    state.cachedNonce = { exists: false, next: 1n, ready: true, reason: null };
    state.freshNonce = { exists: true, next: 2n, ready: true, reason: null };
    await publish();
    expect(state.wire?.intent?.nonce).toBe("2");
  });

  it("still publishes when nothing has changed", async () => {
    await publish();
    expect(state.wire?.intent?.nonce).toBe("1");
  });

  it("says so rather than signing when the nonce cannot be read at all", async () => {
    state.cachedNonce = undefined;
    state.freshNonce = undefined;
    render(<AttestFlow fixedDomain="~alice" fixedHandle="peersky" />);
    fireEvent.click(screen.getByTestId("publish"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("could not read the on-chain nonce")
    );
    expect(state.wire).toBeUndefined();
  });
});

/**
 * "nonce not increasing" is the attester's own term for a record that already exists. Somebody reaches
 * it by publishing twice — usually because the first attempt timed out in the browser and landed
 * anyway — and the phrase says nothing about what happened or what to do next.
 */
describe("what a refused republish says", () => {
  it("says the record already exists, rather than naming the field that refused it", async () => {
    state.attestError = new Error("intent: nonce not increasing");
    render(<AttestFlow fixedDomain="~alice" fixedHandle="peersky" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("already published");
    expect(alert).toHaveTextContent("Reload to see it");
    expect(alert).not.toHaveTextContent("nonce");
  });

  it("passes any other refusal through in the attester's own words", async () => {
    state.attestError = new Error("intent: expired");
    render(<AttestFlow fixedDomain="~alice" fixedHandle="peersky" />);
    expect(screen.getByRole("alert")).toHaveTextContent("intent: expired");
  });
});

describe("linking an account is choosing it", () => {
  afterEach(() => {
    privy.user = { id: "did:privy:x" };
  });

  it("moves the record to the platform just linked", async () => {
    render(<AttestFlow platformsOnly allowLinking />);
    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    expect(linking.linkGithub).toHaveBeenCalled();
    act(() => linking.onSuccess?.({ linkMethod: "github" }));
    expect(screen.getByLabelText("domain")).toHaveValue("github.com");
    act(() => linking.onSuccess?.({ linkMethod: "twitter" }));
    expect(screen.getByLabelText("domain")).toHaveValue("x.com");
  });

  it("starts on an account already linked, and picking it again does not re-link", async () => {
    privy.user = { id: "did:privy:x", github: { username: "lam" } } as typeof privy.user;
    linking.linkGithub.mockClear();
    render(<AttestFlow platformsOnly allowLinking />);
    expect(screen.getByLabelText("domain")).toHaveValue("github.com");
    const github = screen.getByRole("button", { name: "GitHub · linked" });
    expect(github).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(github);
    expect(linking.linkGithub).not.toHaveBeenCalled();
  });
});

describe("a record needs the account it attests", () => {
  afterEach(() => {
    privy.user = { id: "did:privy:x" };
  });

  it("refuses to sign for a platform that is not linked, and says which button to press", async () => {
    privy.user = { id: "did:privy:x", github: { username: "lam" } } as typeof privy.user;
    render(<AttestFlow fixedDomain="discord.com" allowLinking />);
    expect(screen.getByTestId("blocked").textContent).toContain("Link Discord above first");
    expect(screen.getByRole("button", { name: /Sign & publish/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discord" })).toHaveClass("primary");
  });

  it("signs once the account is there", async () => {
    privy.user = { id: "did:privy:x", discord: { username: "lam#1" } } as typeof privy.user;
    render(<AttestFlow fixedDomain="discord.com" allowLinking />);
    expect(screen.queryByTestId("blocked")).toBeNull();
    expect(screen.getByRole("button", { name: /Sign & publish/ })).not.toBeDisabled();
  });
});

describe("a link that fails says so", () => {
  it("names the platform and the reason under the buttons", async () => {
    render(<AttestFlow fixedDomain="github.com" allowLinking />);
    act(() => linking.onError?.("popup_closed", { linkMethod: "github" }));
    const err = screen.getByTestId("link-error").textContent ?? "";
    expect(err).toContain("Linking GitHub failed: popup_closed");
    expect(err).toContain("Privy app");
  });
});

describe("a mail host is met by an email address", () => {
  afterEach(() => {
    privy.user = { id: "did:privy:x" };
  });

  it("offers Email, not Telegram, and a linked address moves the record to its host", async () => {
    const { unmount } = render(<AttestFlow fixedDomain="peersky.xyz" allowLinking />);
    expect(screen.queryByRole("button", { name: /Telegram/ })).toBeNull();
    expect(screen.getByTestId("blocked").textContent).toContain("Link an email address above first");
    expect(screen.getByRole("button", { name: "Email" })).toHaveClass("primary");
    unmount();
    render(<AttestFlow platformsOnly allowLinking />);
    act(() => linking.onSuccess?.({ linkMethod: "email", linkedAccount: { address: "Tim@Peersky.xyz" } }));
    expect(screen.getByLabelText("domain")).toHaveValue("peersky.xyz");
  });

  it("is satisfied by a linked address on that host", async () => {
    privy.user = { id: "did:privy:x", email: { address: "tim@peersky.xyz" } } as typeof privy.user;
    render(<AttestFlow fixedDomain="peersky.xyz" allowLinking />);
    expect(screen.queryByTestId("blocked")).toBeNull();
    expect(screen.getByRole("button", { name: /Sign & publish/ })).not.toBeDisabled();
  });
});

describe("the letter rides with the record", () => {
  it("hands the letter to the relay with the record, and reports that it was written", async () => {
    const published: unknown[] = [];
    render(
      <AttestFlow
        fixedDomain="~alice"
        fixedHandle="lam"
        description={async () => "CTO at Acme 2019-22"}
        onPublished={(p) => published.push(p)}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Sign & publish/ }));
    await waitFor(() => expect(published).toHaveLength(1));
    expect(state.delivered).toMatchObject({ description: "CTO at Acme 2019-22" });
    expect(published[0]).toMatchObject({ letterWritten: true });
  });
});

describe("LinkedIn is one of the doors", () => {
  it("offers a LinkedIn link button and reads a linked LinkedIn as one of the accounts", () => {
    privy.user = { id: "did:privy:x", linkedin: { vanityName: "lam-tr" } } as typeof privy.user;
    render(<AttestFlow platformsOnly allowLinking />);
    expect(screen.getByRole("button", { name: "LinkedIn · linked" })).toBeInTheDocument();
    privy.user = { id: "did:privy:x" };
  });
});
