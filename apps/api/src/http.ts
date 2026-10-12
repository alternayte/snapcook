import type { Household, MemberRole } from "@snapcook/schema";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "validation"
  | "not_found"
  | "forbidden"
  | "unauthenticated"
  | "allowance_exceeded"
  | "adaptation_refused"
  | "upstream_model";

/** The one shape every error response has. */
export function fail<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

export type SessionEnv = {
  Variables: { user: { id: string; name: string; email: string } };
};

export type HouseholdEnv = {
  Variables: SessionEnv["Variables"] & { household: Household; role: MemberRole };
};

/**
 * Marks a response with the change stamp of the data it holds. Returns true when the client
 * already has that version, so the route can answer 304 with no body and no query.
 */
export function unchanged(c: Context, rev: number) {
  const tag = `"${rev}"`;
  c.header("ETag", tag);
  // The client must ask each time; the stamp makes asking cheap.
  c.header("Cache-Control", "private, no-cache");
  return c.req.header("If-None-Match") === tag;
}
