import { createClient } from "@snapcook/api-client";

const baseUrl = process.env.EXPO_PUBLIC_API_URL;
if (!baseUrl) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to apps/mobile/.env.",
  );
}

export const api = createClient(baseUrl);
