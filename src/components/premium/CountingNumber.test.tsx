import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { CountingNumber } from "./CountingNumber";

afterEach(() => vi.useRealTimers());

describe("CountingNumber", () => {
  it("follows the target when data arrives after it started (dashboard showed 0 before)", () => {
    vi.useFakeTimers();
    const { rerender } = render(<span data-testid="n"><CountingNumber target={0} duration={600} triggerOnView={false} /></span>);
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByTestId("n").textContent).toBe("0");

    rerender(<span data-testid="n"><CountingNumber target={5} duration={600} triggerOnView={false} /></span>);
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByTestId("n").textContent).toBe("5");

    rerender(<span data-testid="n"><CountingNumber target={95} duration={600} triggerOnView={false} /></span>);
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByTestId("n").textContent).toBe("95");
  });
});
