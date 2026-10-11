import "@/global.css";

import { PortalHost } from "@rn-primitives/portal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { colorScheme as nativewindColorScheme, useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { IntlProvider } from "react-intl";
import { Platform } from "react-native";
import { en } from "@/lib/messages/en";
import { NAV_THEME } from "@/lib/theme";

export { ErrorBoundary } from "expo-router";

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const [queryClient] = useState(() => new QueryClient());

  // Web only: NativeWind selects the dark CSS variables through a class on <html>,
  // and it sets that class only when the scheme is set explicitly.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => nativewindColorScheme.set(media.matches ? "dark" : "light");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return (
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={NAV_THEME[colorScheme ?? "light"]}>
          <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
          <Stack />
          <PortalHost />
        </ThemeProvider>
      </QueryClientProvider>
    </IntlProvider>
  );
}
