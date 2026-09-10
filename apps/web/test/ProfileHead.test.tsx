import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileHead } from "@/app/ProfileHead";

describe("the head of any page about someone", () => {
  it("leads with who it is, keeping the ENS name underneath", () => {
    render(
      <ProfileHead
        ensName="peersky.ketsuban.eth"
        records={{ name: "Peersky", description: "infra", url: "https://p.example", avatar: "" }}
      />
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Peersky");
    expect(screen.getByTestId("profile-head")).toHaveTextContent("peersky.ketsuban.eth");
    expect(screen.getByTestId("head-url")).toHaveAttribute("href", "https://p.example");
  });

  it("uses the ENS name as the title when nobody has set one", () => {
    // Most people never set a display name; the page must still be titled by something real.
    render(<ProfileHead ensName="peersky.ketsuban.eth" records={{}} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("peersky.ketsuban.eth");
  });

  it("keeps its shape without a picture", () => {
    // The heading sat alone otherwise, and the page read as broken rather than unillustrated.
    render(<ProfileHead ensName="peersky.ketsuban.eth" records={{}} />);
    expect(screen.getByTestId("head-avatar")).toBeInTheDocument();
  });

  it("shows a picture when there is one", () => {
    render(<ProfileHead ensName="a.eth" records={{ avatar: "https://i.example/a.png" }} />);
    expect(screen.getByTestId("head-avatar")).toHaveAttribute("src", "https://i.example/a.png");
  });
});
