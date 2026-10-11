import type { AppType } from "@snapcook/api";
import { hc } from "hono/client";

export const createClient = (baseUrl: string, options?: Parameters<typeof hc>[1]) =>
  hc<AppType>(baseUrl, options);

export type ApiClient = ReturnType<typeof createClient>;
