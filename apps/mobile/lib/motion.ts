import { steps } from "react-native-reanimated";

/** How long one pose is held. Every movement in the app is a whole number of poses. */
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

/** A card dropped onto the page: five poses, a small overshoot, then its resting tilt. */
export const drop = (tilt: number, delayMs = 0) => ({
  animationName: {
    from: {
      opacity: 0,
      transform: [{ translateY: -40 }, { rotate: `${tilt - 8}deg` }, { scale: 1.08 }],
    },
    "60%": {
      opacity: 1,
      transform: [{ translateY: 4 }, { rotate: `${tilt + 2}deg` }, { scale: 0.98 }],
    },
    to: { opacity: 1, transform: [{ translateY: 0 }, { rotate: `${tilt}deg` }, { scale: 1 }] },
  },
  animationDuration: FRAME_MS * 5,
  animationDelay: delayMs,
  animationTimingFunction: steps(5, "jump-none"),
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
