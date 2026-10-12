import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const baseURL = process.env.EXPO_PUBLIC_API_URL;
if (!baseURL) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to apps/mobile/.env.",
  );
}

export const API_URL = baseURL;

// On a phone the session lives in the keychain and is sent as a header.
// In the browser preview it is an ordinary cookie.
export const authClient = createAuthClient({
  baseURL,
  plugins:
    Platform.OS === "web"
      ? []
      : [expoClient({ scheme: "snapcook", storagePrefix: "snapcook", storage: SecureStore })],
});
