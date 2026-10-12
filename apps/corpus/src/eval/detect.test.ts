import { expect, test } from "bun:test";
import { scorePhoto, summarise } from "./detect";

test("precision, recall and F1 come from the counts over all photos", () => {
  const scores = [
    scorePhoto(["milk", "egg", "egg", "mystery jar"], ["milk", "egg", "butter"]),
    // A photo with no food, and nothing proposed, costs nothing either way.
    scorePhoto([], []),
  ];
  expect(scores[0]).toEqual({ hits: 2, proposed: 3, expected: 3 });
  const { precision, recall, f1 } = summarise(scores);
  expect(precision).toBeCloseTo(2 / 3);
  expect(recall).toBeCloseTo(2 / 3);
  expect(f1).toBeCloseTo(2 / 3);
});

test("a proposal on a photo that should be empty lowers precision", () => {
  expect(summarise([scorePhoto(["ghost"], [])]).precision).toBe(0);
});
