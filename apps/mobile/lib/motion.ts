import { steps } from "react-native-reanimated";

/** How long one pose is held. Ornaments (stickers, labels, presses) move in whole poses. */
export const FRAME_MS = 160;

const pose = (rotate: number, x = 0, y = 0) => ({
  transform: [{ rotate: `${rotate}deg` }, { translateX: x }, { translateY: y }],
});

/** A sticker at rest never sits quite still: four held poses around its angle, repeated. */
export const boil = (angle: number) => ({
  animationName: {
    "0%": pose(angle - 1.5),
    "25%": pose(angle + 1, 1, -1),
    "50%": pose(angle - 0.5, -1, 1),
    "75%": pose(angle + 2, 0, -1),
  },
  animationDuration: FRAME_MS * 4,
  animationTimingFunction: steps(1),
  animationIterationCount: "infinite" as const,
});

/** A card laid on the page: a short smooth settle into its resting tilt. Content never moves in
 * held poses, because large stepped jumps read as dropped frames, not as stop motion. */
export const settle = (tilt: number) => ({
  animationName: {
    from: { opacity: 0, transform: [{ translateY: 6 }, { rotate: `${tilt}deg` }] },
    to: { opacity: 1, transform: [{ translateY: 0 }, { rotate: `${tilt}deg` }] },
  },
  animationDuration: 180,
  animationTimingFunction: "ease-out" as const,
  animationFillMode: "both" as const,
});

/** A sticker stuck on: four poses from nothing, past full size, to rest. */
export const pop = (delayMs = 0) => ({
  animationName: {
    "0%": { transform: [{ scale: 0 }, { rotate: "-20deg" }] },
    "50%": { transform: [{ scale: 1.25 }, { rotate: "8deg" }] },
    "75%": { transform: [{ scale: 0.92 }, { rotate: "-3deg" }] },
    "100%": { transform: [{ scale: 1 }, { rotate: "0deg" }] },
  },
  animationDuration: FRAME_MS * 4,
  animationDelay: delayMs,
  animationTimingFunction: steps(4, "jump-none"),
  animationFillMode: "both" as const,
});
