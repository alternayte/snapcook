const { hairlineWidth } = require("nativewind/theme");

const hsl = (name) => `hsl(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind sets the scheme by class on the web. The app has one light theme and no dark styles.
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    // The scrapbook has its own short lists. Nothing from the default palette or type scale is used.
    colors: {
      transparent: "transparent",
      paper: { DEFAULT: hsl("paper"), deep: hsl("paper-deep") },
      card: hsl("card"),
      ink: { DEFAULT: hsl("ink"), soft: hsl("ink-soft") },
      tomato: hsl("tomato"),
      mustard: hsl("mustard"),
      sage: hsl("sage"),
      tape: hsl("tape"),
    },
    fontFamily: {
      display: ["Fraunces_800ExtraBold"],
      title: ["Fraunces_700Bold"],
      body: ["DMSans_400Regular"],
      medium: ["DMSans_500Medium"],
      bold: ["DMSans_700Bold"],
      hand: ["Caveat_700Bold"],
    },
    // A 1.25 scale from 16.
    fontSize: {
      xs: ["12px", "16px"],
      sm: ["14px", "20px"],
      base: ["16px", "24px"],
      lg: ["20px", "26px"],
      xl: ["25px", "28px"],
      "2xl": ["31px", "34px"],
      "3xl": ["39px", "40px"],
    },
    extend: {
      borderRadius: { DEFAULT: "var(--radius)", paper: "3px" },
      borderWidth: { hairline: hairlineWidth(), ink: "1.5px", bold: "2px" },
    },
  },
  plugins: [],
};
