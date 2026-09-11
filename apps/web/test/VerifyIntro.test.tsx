import { render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * The `/verify` intro tells a hiring manager what a page can and cannot support. Every line there is a
 * claim they will calibrate on, so a guarantee this deployment does not have must not appear among them.
 */
const state = { confidential: false };

vi.mock("@/lib/config", () => ({
  loadWebConfig: () => ({
    apiUrl: "http://api.test",
    attestUrl: "http://api.test/v1/attest",
    confidential: state.confidential,
    instances: [{ domain: "ketsuban", parentName: "ketsuban.eth", parentLabel: "ketsuban" }],
  }),
}));
vi.mock("./VerifyForm", () => ({ VerifyForm: () => null }));
vi.mock("@/app/verify/VerifyForm", () => ({ VerifyForm: () => null }));

const { default: VerifyIntro } = await import("@/app/verify/page");

afterEach(cleanup);

describe("what /verify promises a hiring manager", () => {
  it("claims the enclave only where the attester actually runs in one", () => {
    state.confidential = true;
    render(<VerifyIntro />);
    expect(screen.getByText(/Chainlink CRE enclave/)).toBeTruthy();
  });

  it("names the attester that did sign, rather than an enclave this deployment does not run", () => {
    // Signing on the operator's own node is a weaker guarantee than signing in a TEE, and the reader
    // deciding how much to trust the page is exactly the person who must not be told otherwise.
    state.confidential = false;
    render(<VerifyIntro />);
    expect(screen.queryByText(/enclave/)).toBeNull();
    expect(screen.getByText(/attested by this deployment/)).toBeTruthy();
  });
});
