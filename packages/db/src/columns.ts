import { type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, check, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => Bun.randomUUIDv7());

export const timestamptz = () => timestamp({ withTimezone: true, mode: "date" });

export const createdAt = () => timestamptz().notNull().defaultNow();

export const quantity = () => numeric({ precision: 10, scale: 2, mode: "number" });

// Ten decimals: one embedding request costs about a ten-millionth of a dollar.
export const usd = () => numeric({ precision: 16, scale: 10, mode: "number" });

/** A text column typed as a zod enum's values. Pair it with `enumCheck`. */
export const enumText = <T extends string>(e: { options: T[] }) =>
  text({ enum: e.options as [T, ...T[]] });

/** A CHECK constraint that keeps a text column inside a zod enum's values. */
export function enumCheck(name: string, column: AnyPgColumn, values: readonly string[]) {
  const list: SQL = sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", "));
  return check(name, sql`${column} in (${list})`);
}
