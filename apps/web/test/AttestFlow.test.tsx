import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

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
  useLinkAccount: () => ({
    linkTwitter: vi.fn(),
    linkTelegram: vi.fn(),
    linkGithub: vi.fn(),
    linkDiscord: vi.fn(),
    linkGoogle: vi.fn(),
  }),
}));

const state = {
  deliverError: undefined as Error | undefined,
  txHash: undefined as string | undefined,
  attestData: undefined as object | undefined,
  /** What this deployment already holds; anything else is built while the first account is attested */
  mounted: ["ketsuban", "kju-is", "x.com"] as string[],
};

vi.mock("@/lib/hooks", () => ({
  apiFor: () => ({}),
  useContracts: () => ({ data: { instances: state.mounted.map((domain) => ({ domain })) } }),
  useNonce: () => ({ data: { exists: false, next: 1n, ready: true, reason: null } }),
  useNameStatus: () => ({ data: undefined }),
  useAttest: () => ({ data: state.attestData, error: undefined, isPending: false, reset: vi.fn() }),
  useDeliver: () => ({
    data: state.txHash ? { txHash: state.txHash } : undefined,
    error: state.deliverError,
    isPending: false,
    reset: vi.fn(),
  }),
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
