import type { Unit } from "@snapcook/schema";

export type ParsedEntry = { name: string; quantity: number | null; unit: Unit | null };

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };

// Each written unit, with the stored unit and the factor that converts to it.
const UNITS: Record<string, [Unit, number]> = {
  g: ["g", 1],
  gram: ["g", 1],
  grams: ["g", 1],
  kg: ["g", 1000],
  kilo: ["g", 1000],
  kilos: ["g", 1000],
  ml: ["ml", 1],
  cl: ["ml", 10],
  dl: ["ml", 100],
  l: ["ml", 1000],
  litre: ["ml", 1000],
  litres: ["ml", 1000],
  liter: ["ml", 1000],
  liters: ["ml", 1000],
  tbsp: ["tbsp", 1],
  tsp: ["tsp", 1],
  cup: ["cup", 1],
  cups: ["cup", 1],
  x: ["piece", 1],
  pc: ["piece", 1],
  pcs: ["piece", 1],
  piece: ["piece", 1],
  pieces: ["piece", 1],
};

// A number never starts with two zeros: "00 flour" is a name.
const NUMBER = String.raw`((?!0\d)\d+(?:[.,]\d+)?|\d+\/\d+|[½¼¾])`;
const UNIT = `(${Object.keys(UNITS).join("|")})`;
const LEADING = new RegExp(String.raw`^${NUMBER}\s*(?:${UNIT}\b)?\s*(?:of\s+)?(.+)$`, "i");
const TRAILING = new RegExp(String.raw`^(.+?)\s*[,:]?\s+(?:x\s*)?${NUMBER}\s*${UNIT}?$`, "i");

function amount(text: string) {
  if (text in FRACTIONS) return FRACTIONS[text] ?? null;
  if (text.includes("/")) {
    const [top, bottom] = text.split("/").map(Number);
    return top !== undefined && bottom ? top / bottom : null;
  }
  return Number(text.replace(",", "."));
}

function entry(name: string, number: string, unit: string | undefined): ParsedEntry | null {
  const value = amount(number);
  const [stored, factor] = UNITS[unit?.toLowerCase() ?? "piece"] ?? ["piece", 1];
  if (value === null || !Number.isFinite(value) || name.trim() === "") return null;
  return { name: name.trim(), quantity: Math.round(value * factor * 100) / 100, unit: stored };
}

/**
 * Reads what a person typed into the pantry field: "2 bell peppers", "chicken 450g",
 * "1.5 kg potatoes", "milk". A number with no unit is a count. No number means "some".
 */
export function parseEntry(text: string): ParsedEntry {
  const clean = text.trim().replace(/\s+/g, " ");
  const leading = LEADING.exec(clean);
  if (leading) {
    const parsed = entry(leading[3] ?? "", leading[1] ?? "", leading[2]);
    if (parsed) return parsed;
  }
  const trailing = TRAILING.exec(clean);
  if (trailing) {
    const parsed = entry(trailing[1] ?? "", trailing[2] ?? "", trailing[3]);
    if (parsed) return parsed;
  }
  return { name: clean, quantity: null, unit: null };
}
