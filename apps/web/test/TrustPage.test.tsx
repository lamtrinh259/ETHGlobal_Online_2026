import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The claim on this page is the one a reader cannot check for themselves from a name, so it must never
 * be made by a deployment that is not doing it. That is the whole test: the same page, both stances.
 */
const state = {
  confidential: false,
  enclave: { address: "0x8583AD4a0F59Ba45C7E201318C6F774F31f7bbC8", publicKey: "0x04" },
  preflight: {
    ok: true,
    warnings: [] as string[],
    registrar: { signsAs: "0x8583AD4a0F59Ba45C7E201318C6F774F31f7bbC8" },
    multipass: { domains: [{ registrar: "0x8583AD4a0F59Ba45C7E201318C6F774F31f7bbC8" }] },
  },
};

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  createApi: () => ({
    enclaveKey: vi.fn(async () => state.enclave),
    preflight: vi.fn(async () => state.preflight),
  }),
}));

vi.mock("@/lib/config", () => ({
  loadWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test/v1/attest",
    confidential: state.confidential,
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));

const { default: TrustPage } = await import("@/app/trust/page");
const renderPage = async () => render(await TrustPage());

afterEach(cleanup);

describe("what this deployment admits about itself", () => {
  it("does not claim an enclave while the attester signs on its own node", async () => {
    state.confidential = false;
    await renderPage();
    const said = screen.getByTestId("stance").textContent ?? "";
    // Naming the enclave is fine — the handler really is written for one. Saying it is running, or
    // that the operator cannot see the token, is the claim this deployment has not earned.
    expect(said).toMatch(/operator could read them/);
    expect(said).toMatch(/not been enrolled/);
    expect(said).toMatch(/Not claimed here/);
    expect(said).not.toMatch(/nowhere else|neither this service nor its operator/);
  });

  it("claims it where the browser is actually posting to the enclave", async () => {
    state.confidential = true;
    await renderPage();
    expect(screen.getByTestId("stance").textContent ?? "").toMatch(/Nitro enclave/);
    state.confidential = false;
  });

  it("never shows the transaction without saying what was simulated in it", async () => {
    /*
     * The strongest thing on this page is a real transaction, which makes it the easiest to overstate:
     * a run through the mock forwarder with simulated nodes is not a live DON, and a reader who takes
     * it for one has been told something untrue by a page whose whole subject is what to trust.
     */
    await renderPage();
    const run = screen.getByTestId("proven-run").closest("section");
    const said = run?.textContent ?? "";
    expect(said).toMatch(/0x71b7edd5/);
    expect(said).toMatch(/simulated/);
    expect(said).toMatch(/MockKeystoneForwarder/);
  });

  it("shows the three keys agreeing, because that is what makes a signature acceptable", async () => {
    await renderPage();
    expect(screen.getByTestId("key-verdict").textContent ?? "").toMatch(/One key in all three/);
  });

  it("prints the key that all three agree on once, not once per row", async () => {
    /*
     * Three identical 42-character addresses, each wrapping across two lines of a phone, to say the
     * one thing the verdict under them already says. Said in full where a reader can check or copy it,
     * and short in the rows, which are about the roles rather than about the value.
     */
    await renderPage();
    const table = screen.getByTestId("keys").textContent ?? "";
    const full = /0x8583AD4a0F59Ba45C7E201318C6F774F31f7bbC8/gi;
    expect(table.match(full)).toBeNull();
    expect((screen.getByTestId("the-key").textContent ?? "").match(full)).toHaveLength(1);
  });

  it("prints all three in full when they disagree, since which one differs is the point", async () => {
    state.preflight = {
      ...state.preflight,
      multipass: { domains: [{ registrar: "0x000000000000000000000000000000000000dEaD" }] },
    };
    await renderPage();
    const table = screen.getByTestId("keys").textContent ?? "";
    expect(table).toContain("0x8583AD4a0F59Ba45C7E201318C6F774F31f7bbC8");
    expect(table).toContain("0x000000000000000000000000000000000000dEaD");
    expect(screen.queryByTestId("the-key")).toBeNull();
  });

  it("says so loudly when the key the chain expects is not the one signing", async () => {
    // A deployment in this state refuses every record at registration, after the person has signed.
    state.preflight = {
      ...state.preflight,
      multipass: { domains: [{ registrar: "0x000000000000000000000000000000000000dEaD" }] },
    };
    await renderPage();
    const verdict = screen.getByTestId("key-verdict");
    expect(verdict.className).toContain("warning");
    expect(verdict.textContent ?? "").toMatch(/refused at registration/);
  });
});
