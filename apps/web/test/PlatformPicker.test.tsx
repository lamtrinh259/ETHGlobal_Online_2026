import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PLATFORMS, PlatformPicker } from "@/app/PlatformPicker";

describe("choosing platforms", () => {
  it("offers every login method this app can attest, in one list", () => {
    // One list, so a platform added for signing in is offered everywhere it makes sense — rather than
    // three hand-written subsets drifting apart.
    render(<PlatformPicker selected={[]} onToggle={vi.fn()} />);
    for (const p of PLATFORMS) expect(screen.getByTestId(`platform-${p.dns}`)).toBeInTheDocument();
    expect(PLATFORMS.length).toBeGreaterThan(8);
    // The ones Privy actually links, named as the domains a record lives in.
    const dns = PLATFORMS.map((p) => p.dns);
    expect(dns).toEqual(expect.arrayContaining(["x.com", "linkedin.com", "tiktok.com", "t.me"]));
  });

  it("marks what is chosen and reports a change by its domain", () => {
    const onToggle = vi.fn();
    render(<PlatformPicker selected={["linkedin.com"]} onToggle={onToggle} />);
    expect(screen.getByTestId("platform-linkedin.com").className).toMatch(/primary/);
    expect(screen.getByTestId("platform-x.com").className).not.toMatch(/primary/);

    fireEvent.click(screen.getByTestId("platform-x.com"));
    expect(onToggle).toHaveBeenCalledWith("x.com");
  });

  it("can be narrowed to one choice at a time, for asking which platform rather than which several", () => {
    const onToggle = vi.fn();
    render(<PlatformPicker selected={["x.com"]} onToggle={onToggle} single />);
    expect(screen.getByTestId("platform-x.com")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("platform-github.com")).toHaveAttribute("aria-pressed", "false");
  });

  it("names each platform for anyone who cannot see the mark", () => {
    render(<PlatformPicker selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByTestId("platform-github.com")).toHaveAttribute("aria-label", "GitHub");
  });
});
