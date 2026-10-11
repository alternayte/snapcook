import { expect, test } from "bun:test";
import { similarEarlier, withoutKnownNames } from "./dedupe";
import { GridFileError, parseGrid, renderGrid } from "./markdown";

const dish = (id: string, name: string, over: object = {}) => ({
  id,
  name,
  aliases: [] as string[],
  cuisine: "testland",
  dish_type: "main",
  primary_protein: "pulse",
  technique: "soup",
  time_band: "under_30",
  status: "proposed" as const,
  similar_to: null as string | null,
  ...over,
});

test("a proposal is dropped when any of its names is already taken", () => {
  const known = [{ name: "Shakshuka", aliases: ["eggs in purgatory"] }];
  const proposals = [
    { name: "Eggs in  Purgatory", aliases: [] },
    { name: "Dal Tadka", aliases: ["tarka dal"] },
    { name: "Tarka Dal", aliases: [] },
  ];
  expect(withoutKnownNames(proposals, known).map((p) => p.name)).toEqual(["Dal Tadka"]);
});

test("only the later of two similar dishes is marked, and with its closest earlier match", () => {
  const marks = similarEarlier(
    [
      { id: "a", embedding: [1, 0, 0] },
      { id: "b", embedding: [0, 1, 0] },
      { id: "c", embedding: [0.1, 0.99, 0] },
    ],
    0.9,
  );
  expect([...marks]).toEqual([["c", "b"]]);
});

test("the file a person pruned reads back as kept and dropped names", () => {
  const rows = [
    dish("1", "Dal Tadka"),
    dish("2", "Tarka Dal", { similar_to: "1" }),
    dish("3", "Minestrone"),
  ];
  const file = renderGrid(rows);
  // A dish marked as similar starts unticked.
  expect(file).toContain("- [ ] **Tarka Dal**");
  expect(file).toContain("similar to **Dal Tadka**");

  const pruned = file
    .split("\n")
    .filter((line) => !line.includes("**Minestrone**"))
    .join("\n")
    .replace("- [ ] **Tarka Dal**", "- [x] **Tarka Dal** my note");
  expect(
    parseGrid(
      pruned,
      rows.map((r) => r.name),
    ),
  ).toEqual({
    kept: ["Dal Tadka", "Tarka Dal"],
    dropped: ["Minestrone"],
  });
});

test("a renamed dish in the file is an error, not a silent drop", () => {
  const rows = [dish("1", "Dal Tadka")];
  const edited = renderGrid(rows).replace("**Dal Tadka**", "**Dal Tarka**");
  expect(() => parseGrid(edited, ["Dal Tadka"])).toThrow(GridFileError);
});
