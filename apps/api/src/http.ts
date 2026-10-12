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
