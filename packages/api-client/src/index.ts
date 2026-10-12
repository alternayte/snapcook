import type { AppType } from "@snapcook/api";
import { hc } from "hono/client";

export type ApiClient = ReturnType<typeof hc<AppType>>;

export const createClient = (baseUrl: string, options?: Parameters<typeof hc>[1]): ApiClient =>
  hc<AppType>(baseUrl, options);
