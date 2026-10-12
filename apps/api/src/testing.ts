import type { Db } from "@snapcook/db";
import type { Llm } from "@snapcook/llm";
import type { AppDeps } from "./app";
import { createAuth } from "./modules/auth/auth";
import { createServer } from "./server";

const ORIGIN = "http://localhost";

/** The server as tests use it: real sign-in on the given database, and a model that is not called. */
export function createTestServer(
  db: Db,
  over: { llm?: Llm; ownerEmails?: string[]; snaps?: AppDeps["snaps"] } = {},
) {
  const auth = createAuth(db, {
    secret: "test-secret-test-secret-test-secret",
    baseUrl: ORIGIN,
    trustedOrigins: [ORIGIN],
  });
  const llm =
    over.llm ??
    (new Proxy({}, { get: () => () => Promise.reject(new Error("no model in tests")) }) as Llm);
  const server = createServer({
    db,
    auth,
    llm,
    corsOrigins: [],
    ownerEmails: over.ownerEmails ?? [],
    adaptModel: "test-model",
    snaps: over.snaps ?? {
      snapDir: "/nonexistent",
      enqueueDetect: () => Promise.reject(new Error("no job runner in this test")),
    },
  });

  /** Signs a new user up and returns the headers that make later requests theirs. */
  async function signUp(email: string, password = "correct horse battery") {
    const res = await server.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name: email.split("@")[0], email, password }),
    });
    if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const cookie = res.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    return { cookie, origin: ORIGIN };
  }

  /** A signed-up user with a household of their own. */
  async function signUpWithHousehold(email: string) {
    const headers = await signUp(email);
    const res = await server.request("/api/v1/household", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Home" }),
    });
    if (res.status !== 201) throw new Error(`household failed: ${res.status} ${await res.text()}`);
    return headers;
  }

  return { server, signUp, signUpWithHousehold };
}
