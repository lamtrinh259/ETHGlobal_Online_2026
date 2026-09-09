import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "@/app/Switch";

describe("Switch", () => {
  it("is a switch to a screen reader and reports its state both ways", () => {
    const onChange = vi.fn();
    render(
      <Switch checked={true} onChange={onChange} label="Keep my handle private" hint="On: you decide." />
    );
    const control = screen.getByRole("switch");
    expect(control).toBeChecked();
    expect(screen.getByText("Keep my handle private")).toBeVisible();
    expect(screen.getByText("On: you decide.")).toBeVisible();

    control.click();
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
