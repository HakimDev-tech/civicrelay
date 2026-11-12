import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { closeDb, getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

const databaseUrl = process.env.CIVICRELAY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

integration("Better Auth email lifecycle (isolated PostgreSQL database)", () => {
  const email = `auth-${randomUUID()}@example.invalid`;
  const password = "CivicRelay-Test-Password-2026!";
  const sentEmails: string[] = [];

  beforeAll(() => {
    if (!databaseUrl) throw new Error("CIVICRELAY_TEST_DATABASE_URL is required.");
    process.env.DATABASE_URL = databaseUrl;
    if (process.env.NODE_ENV === "production") throw new Error("Auth integration tests must never run in production.");
    if (process.env.CIVICRELAY_TEST_DATABASE_CONFIRMATION !== "ISOLATED_BRANCH") {
      throw new Error("Auth integration tests require explicit isolated-database confirmation.");
    }

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://api.resend.com/emails") {
        const payload = JSON.parse(String(init?.body)) as { text: string };
        sentEmails.push(payload.text);
        return Response.json({ id: "email_test_only" }, { status: 200 });
      }

      throw new Error("Unexpected outbound network request in auth integration test.");
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeDb();
  });

  it("signs up, verifies the email, signs in, and resolves the authenticated session", async () => {
    const handlers = toNextJsHandler(getAuth());
    const signUpResponse = await handlers.POST(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        name: "CivicRelay Auth Test",
        email,
        password,
        callbackURL: "/dashboard",
      }),
    }));

    expect(signUpResponse.status).toBe(200);
    expect(sentEmails).toHaveLength(1);

    const [createdUser] = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    expect(createdUser?.emailVerified).toBe(false);

    const verificationLink = sentEmails[0]?.match(/https?:\/\/[^\s]+/)?.[0];
    expect(verificationLink).toBeTruthy();

    const verificationResponse = await handlers.GET(new Request(verificationLink!, {
      method: "GET",
      headers: { origin },
    }));

    expect([200, 302, 303, 307, 308]).toContain(verificationResponse.status);

    const [verifiedUser] = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    expect(verifiedUser?.emailVerified).toBe(true);

    const signInResponse = await handlers.POST(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        email,
        password,
        callbackURL: "/dashboard",
      }),
    }));

    expect(signInResponse.status).toBe(200);
    const cookies = signInResponse.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookies).toContain("better-auth.session_token");

    const sessionResponse = await handlers.GET(new Request(`${origin}/api/auth/get-session`, {
      method: "GET",
      headers: {
        cookie: cookies,
        origin,
      },
    }));

    expect(sessionResponse.status).toBe(200);
    const session = await sessionResponse.json() as { user?: { email?: string } };
    expect(session.user?.email).toBe(email);
  });
});
