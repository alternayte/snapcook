import { createClient } from "@snapcook/api-client";
import { Platform } from "react-native";
import { API_URL, authClient } from "@/lib/auth";

export const api = createClient(API_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => {
    if (Platform.OS === "web") return fetch(input, { ...init, credentials: "include" });
    const headers = new Headers(init?.headers);
    const cookie = (authClient as unknown as { getCookie: () => string }).getCookie();
    if (cookie) headers.set("cookie", cookie);
    return fetch(input, { ...init, headers, credentials: "omit" });
  },
}).api.v1;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The body of a successful response. Anything else becomes an ApiError with the server's code. */
export async function unwrap<T>(
  response: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
) {
  const res = await response;
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (res.ok) return body as T;
  const error = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
  throw new ApiError(res.status, error?.code ?? "unknown", error?.message ?? "");
}
