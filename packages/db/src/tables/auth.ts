import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, timestamptz } from "../columns";
import { users } from "./household";

// The sign-in library owns the rows of these tables. Their columns follow its model.

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: id(),
    user_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    expires_at: timestamptz().notNull(),
    ip_address: text(),
    user_agent: text(),
    created_at: createdAt(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.user_id)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: id(),
    user_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    account_id: text().notNull(),
    provider_id: text().notNull(),
    access_token: text(),
    refresh_token: text(),
    id_token: text(),
    access_token_expires_at: timestamptz(),
    refresh_token_expires_at: timestamptz(),
    scope: text(),
    password: text(),
    created_at: createdAt(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.user_id)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expires_at: timestamptz().notNull(),
    created_at: createdAt(),
    updated_at: timestamptz().notNull().defaultNow(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);
