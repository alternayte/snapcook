import "@/global.css";

import { Caveat_700Bold } from "@expo-google-fonts/caveat";
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { Fraunces_700Bold, Fraunces_800ExtraBold } from "@expo-google-fonts/fraunces";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { IntlProvider } from "react-intl";
import { AppState, Platform } from "react-native";
import { en } from "@/lib/messages/en";
import { NAV_THEME } from "@/lib/theme";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const [fontsReady, fontError] = useFonts({
    Caveat_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    Fraunces_700Bold,
    Fraunces_800ExtraBold,
  });
  const ready = fontsReady || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // On a phone, coming back to the app counts as looking at it again, so stale data is re-read.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const listener = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    return () => listener.remove();
  }, []);

  if (!ready) return null;

  return (
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={NAV_THEME}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </QueryClientProvider>
    </IntlProvider>
  );
}
