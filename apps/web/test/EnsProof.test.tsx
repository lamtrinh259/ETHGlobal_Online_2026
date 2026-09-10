import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnsProof } from "@/app/EnsProof";
import type { EnsResolution } from "@/lib/api";

const ens: EnsResolution = {
  name: "alice.ketsuban.eth",
  universalResolver: "0x4A1817d13E9cF196f471725176355C1234b63C70",
  resolver: "0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e",
  addr: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  texts: { "ketsuban:answer": "terrible dictator", avatar: "", description: "infra lead" },
  status: "active",
  warning: "w",
};

describe("EnsProof", () => {
  it("names the resolver it reached and lists only the records that have a value", () => {
    render(<EnsProof ens={ens} name="alice.ketsuban.eth" />);
    const card = screen.getByTestId("ens-proof");
    expect(card).toHaveTextContent("0x4A18…3C70");
    expect(card).toHaveTextContent("0x178f…215e");
    expect(card).toHaveTextContent("0xEE48…9F3a");
    expect(card).toHaveTextContent("terrible dictator");
    expect(card).toHaveTextContent("infra lead");
    expect(card).not.toHaveTextContent("avatar");
    expect(card.querySelector("pre")).toHaveTextContent("cast namehash alice.ketsuban.eth");
  });

  it("says so when the name resolves to nothing", () => {
    render(
      <EnsProof ens={{ ...ens, addr: null, status: "inactive", texts: {} }} name="nobody.ketsuban.eth" />
    );
    expect(screen.getByTestId("ens-proof")).toHaveTextContent("nothing is registered here right now");
  });

  it("degrades when no universal resolver is configured", () => {
    render(<EnsProof ens={null} name="alice.ketsuban.eth" />);
    expect(screen.getByTestId("ens-proof")).toHaveTextContent("no UniversalResolver configured");
    expect(screen.getByTestId("ens-proof").querySelector("pre")).toHaveTextContent("<universal-resolver>");
  });
});

describe("the command it tells you to run", () => {
  it("gives one that cast can actually execute", () => {
    // `cast --to-dns-name` does not exist — cast has no DNS encoder at all — so the command printed
    // here has to carry the wire-format name itself or nobody can run it.
    render(<EnsProof ens={ens} name="alice.ketsuban.eth" />);
    const cmd = screen.getByTestId("ens-proof").querySelector("pre")!.textContent!;
    expect(cmd).not.toContain("--to-dns-name");
    // The DNS wire name for alice.ketsuban.eth, length-prefixed and root-terminated.
    expect(cmd).toContain("0x05616c696365086b6574737562616e0365746800");
    // The parts cast does have are still used.
    expect(cmd).toContain("cast namehash alice.ketsuban.eth");
    expect(cmd).toContain("resolve(bytes,bytes)(bytes,address)");
  });

  it("asks for a record this name actually has, so the command returns something", () => {
    // Printing a key that is empty on this name teaches a reader nothing about whether it worked.
    render(<EnsProof ens={ens} name="alice.ketsuban.eth" />);
    expect(screen.getByTestId("ens-proof").querySelector("pre")).toHaveTextContent("ketsuban:answer");

    render(<EnsProof ens={{ ...ens, texts: { description: "infra lead" } }} name="alice.ketsuban.eth" />);
    expect(screen.getAllByTestId("ens-proof")[1].querySelector("pre")).toHaveTextContent("description");
  });

  it("does not blame configuration for a read that simply failed", () => {
    // The page collapses every failure to `null`; claiming a specific cause it cannot know sends
    // whoever is debugging to the wrong place.
    render(<EnsProof ens={null} name="alice.ketsuban.eth" />);
    expect(screen.getByTestId("ens-proof")).toHaveTextContent(/could not be read|not configured or/i);
  });
});

describe("where the ENS cross-check belongs", () => {
  it("is an appendix, folded away until someone wants it", () => {
    // It is the proof, not the product: a reader who wants the page should not have to scroll past
    // resolver addresses and a shell command to find it.
    render(<EnsProof ens={ens} name="alice.ketsuban.eth" />);
    const card = screen.getByTestId("ens-proof");
    const fold = card.querySelector("details");
    expect(fold).not.toBeNull();
    // Closed by default: opening it is a deliberate act.
    expect(fold).not.toHaveAttribute("open");
    expect(card.querySelector("summary")).toHaveTextContent(/read it yourself/i);
  });
});
