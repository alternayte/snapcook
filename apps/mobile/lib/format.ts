import type { Unit } from "@snapcook/schema";

const FRACTIONS: Record<string, string> = { "0.25": "¼", "0.5": "½", "0.75": "¾" };

/** A quantity as a cook reads it: "400 g", "1½", "2 tbsp". */
export function amount(quantity: number, unit: Unit) {
  const whole = Math.floor(quantity);
  const part = FRACTIONS[String(Math.round((quantity - whole) * 100) / 100)];
  const number = part ? `${whole === 0 ? "" : whole}${part}` : String(quantity);
  return unit === "piece" ? number : `${number} ${unit}`;
}

/** Seconds as a countdown: "4:05". */
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** One press of a stepper, by unit: one of a counted thing, 50 g, 100 ml. */
export const STEP: Record<Unit, number> = { piece: 1, g: 50, ml: 100, tbsp: 1, tsp: 1, cup: 1 };
