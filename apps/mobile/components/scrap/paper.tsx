import { BottomTabBarHeightContext } from "expo-router/js-tabs";
import { type ReactNode, useContext } from "react";
import { ScrollView, View, type ViewProps } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { settle } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** The page every screen sits on. */
export function Page({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  // Inside the tabs, the tab bar already keeps clear of the system navigation bar.
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  return (
    <SafeAreaView className="flex-1 bg-paper" edges={inTabs ? ["top", "left", "right"] : undefined}>
      {scroll ? (
        <ScrollView
          contentContainerClassName="mx-auto w-full max-w-[430px] gap-6 px-5 pb-16 pt-6"
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View className="mx-auto w-full max-w-[430px] flex-1 gap-6 px-5 pt-6">{children}</View>
      )}
    </SafeAreaView>
  );
}

/** A strip of tape across the top edge of a card. */
function Tape({ angle }: { angle: number }) {
  return (
    <View
      pointerEvents="none"
      className="absolute -top-3 h-6 w-24 self-center bg-tape/70"
      style={{ transform: [{ rotate: `${angle}deg` }] }}
    />
  );
}

type CardProps = ViewProps & {
  /** Resting tilt in degrees. */
  tilt?: number;
  tape?: boolean;
};

/** A piece of paper stuck on the page: slightly tilted, with a soft shadow. */
export function Card({ tilt = -1, tape = false, className, style, children, ...props }: CardProps) {
  const still = useReducedMotion();
  return (
    // The moving layer carries no classes: class names do not reach an animated view on the web.
    <Animated.View
      style={[style, still ? { transform: [{ rotate: `${tilt}deg` }] } : settle(tilt)]}
    >
      <View
        className={cn("rounded-paper bg-card p-4 shadow-md shadow-ink/30", className)}
        {...props}
      >
        {tape ? <Tape angle={tilt < 0 ? -4 : 5} /> : null}
        {children}
      </View>
    </Animated.View>
  );
}

/** A small printed label, as from a label maker. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View
      className={cn("self-start rounded-[2px] bg-mustard px-2.5 py-1.5", className)}
      style={{ transform: [{ rotate: "-2deg" }] }}
    >
      {children}
    </View>
  );
}
