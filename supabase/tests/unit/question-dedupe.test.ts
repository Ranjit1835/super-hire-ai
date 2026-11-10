import { describe, it, expect } from "vitest";
import { avoidList, overlap, repeats, SAME_QUESTION } from "../../functions/_shared/question-dedupe";

describe("question repeats (owner, 2026-11-10)", () => {
  const train = { title: "Train speed", statement: "A train covers 120 km in 2 hours. What is its average speed in km/h?" };

  it("the same wording with cosmetic changes is a repeat", () => {
    expect(overlap(train.statement, "a TRAIN covers 120 km in 2 hours; what is the average speed (km/h)?")).toBeGreaterThanOrEqual(SAME_QUESTION);
    expect(repeats({ title: "Speed of a train", statement: "A train covers 120 km in 2 hours. Find its average speed in km/h." }, [train])).toBe(train);
  });

  it("the same title is a repeat, whatever the wording", () => {
    expect(repeats({ title: "  train SPEED ", statement: "Something different." }, [train])).toBe(train);
  });

  it("different numbers or a different scenario are new questions", () => {
    expect(repeats({ title: "Train speed 2", statement: "A train covers 150 km in 3 hours. What is its average speed in km/h?" }, [train])).toBeNull();
    expect(repeats({ title: "Cyclist", statement: "A cyclist rides at 15 km/h for 3 hours. How far does she go?" }, [train])).toBeNull();
  });

  it("tells the model what to avoid, compactly", () => {
    expect(avoidList([])).toBe("");
    const list = avoidList(Array.from({ length: 60 }, (_, i) => ({ title: `Q${i}`, statement: "x ".repeat(200) })));
    expect(list).toMatch(/^Already in the bank/);
    expect(list.split("\n")).toHaveLength(41);                 // header + at most 40
    expect(list.split("\n")[1].length).toBeLessThan(200);
  });
});
