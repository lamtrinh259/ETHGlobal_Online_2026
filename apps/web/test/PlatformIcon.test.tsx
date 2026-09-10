import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformIcon } from "@/app/PlatformIcon";

describe("platform icons", () => {
  it("draws the brand mark for a platform this app connects to", () => {
    render(<PlatformIcon domain="github.com" />);
    const svg = screen.getByTestId("icon-github.com");
    // Real path data, not a placeholder: an empty `d` renders an invisible icon that looks broken.
    expect(svg.querySelector("path")?.getAttribute("d")?.length ?? 0).toBeGreaterThan(50);
    expect(svg).toHaveAttribute("aria-label", "GitHub");
  });

  it("reads the DNS name and the flat platform as the same brand", () => {
    // A record written before the DNS namespace lives in `github`; it is the same account either way.
    const flat = render(<PlatformIcon domain="github" />).getByTestId("icon-github");
    const dns = render(<PlatformIcon domain="github.com" />).getByTestId("icon-github.com");
    expect(flat.querySelector("path")?.getAttribute("d")).toBe(dns.querySelector("path")?.getAttribute("d"));
  });

  it("falls back to a monogram for a mail host nobody has a brand for", () => {
    // Any domain can be attested, so most of them will never have an icon; a broken image is worse.
    render(<PlatformIcon domain="peeramid.xyz" />);
    const chip = screen.getByTestId("icon-peeramid.xyz");
    expect(chip).toHaveTextContent("p");
    expect(chip).toHaveAttribute("aria-label", "peeramid.xyz");
  });
});
