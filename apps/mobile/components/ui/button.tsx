import { cva, type VariantProps } from "class-variance-authority";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { steps, useReducedMotion } from "react-native-reanimated";
import { TextClassContext } from "@/components/ui/text";
import { FRAME_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

const face = cva("flex-row items-center justify-center gap-2 rounded border-bold border-ink", {
  variants: {
    variant: {
      primary: "bg-tomato",
      paper: "bg-card",
      quiet: "border-transparent bg-transparent",
    },
    size: { md: "min-h-12 px-5 py-3", sm: "min-h-9 px-3 py-1.5" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

const label = cva("", {
  variants: {
    variant: {
      primary: "font-title text-lg text-card",
      paper: "font-title text-lg text-ink",
      quiet: "font-bold text-base text-tomato underline",
    },
    size: { md: "", sm: "text-base" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

// How far the button stands off the page, and so how far it travels when pressed.
const LIFT = 4;

type ButtonProps = Omit<React.ComponentProps<typeof Pressable>, "style"> &
  VariantProps<typeof face> & { className?: string };

/** A button cut from card. Pressing pushes it flat onto the page in two held poses. */
function Button({ className, variant, size, disabled, children, ...props }: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const still = useReducedMotion();
  const flat = variant === "quiet";
  const offset = pressed && !flat ? LIFT : 0;
  return (
    <Pressable
      role="button"
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={cn("self-stretch", disabled && "opacity-50", className)}
      {...props}
    >
      {flat ? null : (
        <View
          pointerEvents="none"
          className="absolute inset-0 rounded bg-ink"
          style={{ transform: [{ translateX: LIFT }, { translateY: LIFT }] }}
        />
      )}
      <Animated.View
        style={{
          transform: [{ translateX: offset }, { translateY: offset }],
          transitionProperty: "transform",
          transitionDuration: still ? 0 : FRAME_MS * 2,
          transitionTimingFunction: steps(2),
        }}
      >
        <View className={face({ variant, size })}>
          <TextClassContext.Provider value={label({ variant, size })}>
            {children as React.ReactNode}
          </TextClassContext.Provider>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export type { ButtonProps };
export { Button };
