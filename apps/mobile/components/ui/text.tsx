import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Text as RNText } from "react-native";
import { cn } from "@/lib/utils";

const textVariants = cva("text-ink", {
  variants: {
    variant: {
      body: "font-body text-base",
      strong: "font-bold text-base",
      small: "font-body text-sm text-ink-soft",
      label: "font-bold text-xs uppercase tracking-widest",
      display: "font-display text-3xl tracking-tight",
      title: "font-title text-xl",
      heading: "font-title text-lg",
      // Handwriting is for short notes only, never for anything a person must read to act.
      hand: "font-hand text-xl text-ink-soft",
    },
  },
  defaultVariants: { variant: "body" },
});

const HEADINGS = new Set(["display", "title", "heading"]);

/** Lets a container, such as a button, set the type of the text inside it. */
const TextClassContext = React.createContext<string | undefined>(undefined);

type TextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textVariants>;

function Text({ className, variant, ...props }: TextProps) {
  const inherited = React.useContext(TextClassContext);
  return (
    <RNText
      className={cn(textVariants({ variant }), inherited, className)}
      role={HEADINGS.has(variant ?? "") ? "heading" : undefined}
      {...props}
    />
  );
}

export { Text, TextClassContext };
