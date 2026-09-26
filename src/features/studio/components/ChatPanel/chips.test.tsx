import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickActionChips } from "./QuickActionChips";
import { PersonaSelector } from "./PersonaSelector";

const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;

describe("Studio chips", () => {
  it("quick actions show a lucide icon and plain label, no emoji", () => {
    const { container } = render(<QuickActionChips onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(8);
    for (const b of buttons) {
      expect(b.querySelector("svg")).not.toBeNull();
      expect(EMOJI.test(b.textContent ?? "")).toBe(false);
    }
    expect(EMOJI.test(container.textContent ?? "")).toBe(false);
  });

  it("personas show a lucide icon, no emoji", () => {
    const { container } = render(<PersonaSelector selected={"big-tech" as never} onChange={vi.fn()} />);
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(5);
    expect(EMOJI.test(container.textContent ?? "")).toBe(false);
  });
});
