import { Image } from "expo-image";
import type { ViewStyle } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { boil, pop } from "@/lib/motion";

const STICKERS = {
  tomato: require("@/assets/stickers/tomato.png"),
  lemon: require("@/assets/stickers/lemon.png"),
  garlic: require("@/assets/stickers/garlic.png"),
  spoon: require("@/assets/stickers/spoon.png"),
  pan: require("@/assets/stickers/pan.png"),
  chilli: require("@/assets/stickers/chilli.png"),
} as const;

export type StickerName = keyof typeof STICKERS;

type Props = {
  name: StickerName;
  size: number;
  /** Resting angle in degrees. */
  angle?: number;
  /** Delay before it is stuck on, in milliseconds. */
  delay?: number;
  style?: ViewStyle;
};

/** A cut-paper sticker. It is decoration, so assistive technology skips it. */
export function Sticker({ name, size, angle = 0, delay = 0, style }: Props) {
  const still = useReducedMotion();
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width: size, height: size },
        style,
        still ? { transform: [{ rotate: `${angle}deg` }] } : boil(angle),
      ]}
    >
      <Animated.View style={[{ flex: 1 }, still ? undefined : pop(delay)]}>
        <Image source={STICKERS[name]} style={{ flex: 1 }} contentFit="contain" />
      </Animated.View>
    </Animated.View>
  );
}
