import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const sp = vi.hoisted(() => ({ outcome: "done" as string, micError: null as null | { name: string } }));
vi.mock("@/lib/speech", async (orig) => ({
  ...(await orig<typeof import("@/lib/speech")>()),
  isTtsSupported: () => true,
  isSttSupported: () => true,
  primeSpeech: vi.fn(),
  speakText: () => ({ done: Promise.resolve(sp.outcome), cancel: () => {} }),
  startMicLevel: async (onLevel: (l: number) => void) => {
    if (sp.micError) throw sp.micError;
    onLevel(0.5);
    return { stop: () => {} };
  },
}));

import { AudioCheck } from "./AudioCheck";

beforeEach(() => { sp.outcome = "done"; sp.micError = null; });

describe("AudioCheck", () => {
  it("confirms the speaker and microphone work", async () => {
    const onChange = vi.fn();
    render(<AudioCheck onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Play test voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));
    expect(screen.getByText("Working")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test microphone" }));
    expect(await screen.findByText("We can hear you")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ speakerOk: true, micOk: true });
  });

  it("tells the user to tap when the browser blocks audio, and how to fix silence", async () => {
    sp.outcome = "blocked";
    render(<AudioCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Play test voice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/blocked the sound/);

    sp.outcome = "done";
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    fireEvent.click(await screen.findByRole("button", { name: "No" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Silent mode/);
  });

  it("explains a denied microphone instead of failing silently", async () => {
    sp.micError = { name: "NotAllowedError" };
    render(<AudioCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Test microphone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Microphone permission denied/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
