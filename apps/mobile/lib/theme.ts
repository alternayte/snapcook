import { DefaultTheme, type Theme } from "expo-router/react-navigation";

// The same values as the CSS variables in global.css, for the places that need a plain colour.
export const COLORS = {
  paper: "hsl(41 58% 91%)",
  card: "hsl(40 100% 97%)",
  ink: "hsl(25 25% 14%)",
  inkSoft: "hsl(27 13% 41%)",
  tomato: "hsl(8 64% 50%)",
} as const;

export const NAV_THEME: Theme = {
  ...DefaultTheme,
  colors: {
    background: COLORS.paper,
    border: COLORS.ink,
    card: COLORS.paper,
    notification: COLORS.tomato,
    primary: COLORS.tomato,
    text: COLORS.ink,
  },
};
