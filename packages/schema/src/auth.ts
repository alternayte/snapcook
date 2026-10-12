import { z } from "zod";
import { Id } from "./enums";

/** A signed-in device. The token is what the client sends back. */
export const AuthSession = z.object({
  id: Id,
  user_id: Id,
  token: z.string().min(1),
  expires_at: z.date(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type AuthSession = z.infer<typeof AuthSession>;

/** One way a user signs in: a password, or an identity at a provider. */
export const AuthAccount = z.object({
  id: Id,
  user_id: Id,
  account_id: z.string().min(1),
  provider_id: z.string().min(1),
  access_token: z.string().nullable(),
  refresh_token: z.string().nullable(),
  id_token: z.string().nullable(),
  access_token_expires_at: z.date().nullable(),
  refresh_token_expires_at: z.date().nullable(),
  scope: z.string().nullable(),
  password: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type AuthAccount = z.infer<typeof AuthAccount>;

/** A short-lived value that proves a sign-in step, such as a provider round trip. */
export const AuthVerification = z.object({
  id: Id,
  identifier: z.string().min(1),
  value: z.string().min(1),
  expires_at: z.date(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type AuthVerification = z.infer<typeof AuthVerification>;
