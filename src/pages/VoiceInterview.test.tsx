import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "u@example.com" }, session: { access_token: "t" } }) }));
const speech = vi.hoisted(() => ({ primeSpeech: vi.fn(), order: [] as string[] }));
vi.mock("@/lib/speech", async (orig) => {
  const real = await orig<typeof import("@/lib/speech")>();
  return {
    ...real,
    primeSpeech: () => { speech.order.push("prime"); speech.primeSpeech(); },
    speakText: () => ({ done: new Promise(() => {}), cancel: () => {} }),
    isTtsSupported: () => true,
    isSttSupported: () => true,
  };
});

import VoiceInterview from "./VoiceInterview";

// Radix Select needs these in jsdom.
Object.assign(Element.prototype, { hasPointerCapture: () => false, releasePointerCapture: () => {}, scrollIntoView: () => {} });

beforeEach(() => {
  speech.order.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    if (body.action === "check-access") return new Response(JSON.stringify({ canAccess: true }), { status: 200 });
    speech.order.push(`api:${body.action}`);
    return new Promise<Response>(() => {}); // the start call is slow (Gemini) — never resolves here
  }));
});

describe("VoiceInterview", () => {
  it("unlocks speech inside the Start tap, before the slow first AI call returns (root cause of the silent interviewer)", async () => {
    render(<MemoryRouter><VoiceInterview /></MemoryRouter>);
    expect(await screen.findByText("Test your mic and speaker")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("combobox")[0]); // Target Role (first select)
    fireEvent.click(await screen.findByRole("option", { name: "Java Developer" }));
    fireEvent.click(screen.getByRole("button", { name: /Start Voice Interview/ }));

    await waitFor(() => expect(speech.order).toContain("api:start"));
    expect(speech.order.indexOf("prime")).toBeGreaterThanOrEqual(0);
    expect(speech.order.indexOf("prime")).toBeLessThan(speech.order.indexOf("api:start"));
  });
});
