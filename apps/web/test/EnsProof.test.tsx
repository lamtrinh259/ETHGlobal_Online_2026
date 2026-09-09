import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnsProof } from "@/app/EnsProof";
import type { EnsResolution } from "@/lib/api";

const ens: EnsResolution = {
  name: "alice.ketsuban.eth",
  universalResolver: "0x4a1817d13E9cF196f471725176355c1234b63c70",
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
    expect(card).toHaveTextContent("0x4a18…3c70");
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
