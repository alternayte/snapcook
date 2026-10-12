import { expo } from "@better-auth/expo";
import { type Db, schema } from "@snapcook/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export type AuthConfig = {
  /** Signs session cookies and tokens. */
  secret: string;
  /** The public address of this API, as clients reach it. */
  baseUrl: string;
  /** Origins and app URL schemes that may start a sign-in. */
  trustedOrigins: string[];
  apple?: { clientId: string; clientSecret: string; appBundleIdentifier: string };
  google?: { clientId: string; clientSecret: string };
};

const stamps = { createdAt: "created_at", updatedAt: "updated_at" };

/** Sign-in on this API's own tables. A provider is on only when its credentials are set. */
export function createAuth(db: Db, config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    user: { fields: { emailVerified: "email_verified", ...stamps } },
    session: {
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        ...stamps,
      },
    },
    account: {
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        ...stamps,
      },
    },
    verification: { fields: { expiresAt: "expires_at", ...stamps } },
    advanced: { database: { generateId: () => Bun.randomUUIDv7() } },
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders: {
      ...(config.apple ? { apple: config.apple } : {}),
      ...(config.google ? { google: config.google } : {}),
    },
    plugins: [expo()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
