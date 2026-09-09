import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Explain } from "@/app/names/Explain";
import type { Contracts } from "@/lib/api";

const mount = (domain: string, parentName: string, maskedParentName?: string) => ({
  domain,
  parentName,
  parentLabel: domain.split(".").pop() as string,
  registry: "0x0000000000000000000000000000000000000001" as const,
  resolver: "0x0000000000000000000000000000000000000002" as const,
  ...(maskedParentName ? { maskedParentName } : {}),
});

const contracts = {
  instances: [
    mount("ketsuban", "ketsuban.eth"),
    mount("discord.com", "com.discord.www.ketsuban.eth", "com.discord.private-www.ketsuban.eth"),
  ],
  bridge: "0x0000000000000000000000000000000000000003" as const,
  permissionedResolver: null,
} as Contracts;

describe("reading a name", () => {
  it("says what it claims and offers to check it", () => {
    render(<Explain contracts={contracts} nameDomains={["ketsuban"]} />);
    fireEvent.change(screen.getByTestId("explain-input"), {
      target: { value: "alice.com.discord.private-www.ketsuban.eth" },
    });
    expect(screen.getByTestId("explain-says")).toHaveTextContent("holds an account at discord.com");
    expect(screen.getByRole("link", { name: /Check whether it resolves/ })).toHaveAttribute(
      "href",
      "/v/alice.com.discord.private-www.ketsuban.eth"
    );
  });

  it("does not offer to check a name this deployment could never answer", () => {
    render(<Explain contracts={contracts} nameDomains={["ketsuban"]} />);
    fireEvent.change(screen.getByTestId("explain-input"), { target: { value: "alice.example.com" } });
    expect(screen.getByTestId("explain-says")).toHaveTextContent("ends outside every namespace");
    expect(screen.queryByRole("link", { name: /Check whether it resolves/ })).toBeNull();
  });
});
