import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerifyCard } from "@/app/VerifyCard";
import type { Verification } from "@/lib/api";

const base: Verification = {
  name: "alice.ketsuban.eth",
  instance: { domain: "ketsuban", parentName: "ketsuban.eth" },
  status: "active",
  wallet: "0xEE4811b9462956C9C3535E79c08776D769CA9F3a",
  answer: "terrible dictator",
  expiresAt: "2026-10-08T09:14:22.000Z",
  humanity: { level: "medium", until: null },
  links: [
    { domain: "x", optedIn: true, commitment: "0x01", disclosed: { handle: "alice", platformId: "42" } },
    { domain: "telegram", optedIn: true, commitment: "0x02" },
    { domain: "github", optedIn: false },
  ],
  evidence: ["wallet_binding", "humanity_attestation", "x_account_control"],
  decision: "additional_context_available",
  warning: "This is not identity verification.",
};

describe("VerifyCard", () => {
  it("renders an active record with disclosed, masked and public links, and the warning", () => {
    render(<VerifyCard v={base} />);
    expect(screen.getByRole("heading", { name: "alice.ketsuban.eth" })).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("active");
    expect(screen.getByTestId("answer")).toHaveTextContent("terrible dictator");
    expect(screen.getByTestId("humanity")).toHaveTextContent("medium");
    const links = screen.getByTestId("links").querySelectorAll("li");
    expect(links[0]).toHaveTextContent("@alice (id 42)");
    expect(links[1]).toHaveTextContent("masked — needs a view code");
    expect(links[2]).toHaveTextContent("verified");
    expect(screen.getByRole("note")).toHaveTextContent(base.warning);
    expect(screen.getByText("wallet_binding, humanity_attestation, x_account_control")).toBeInTheDocument();
  });

  it("renders an inactive record without details but still with the warning", () => {
    render(
      <VerifyCard
        v={{ ...base, status: "inactive", wallet: null, answer: null, links: [], humanity: null }}
      />
    );
    expect(screen.getByTestId("status")).toHaveTextContent("no record");
    expect(screen.queryByTestId("answer")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(base.warning);
  });
});
