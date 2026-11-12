import "server-only";

import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDb, schema } from "@/lib/db";
import { sendAuthEmail, passwordResetEmailText, verificationEmailText } from "./email";

const trustedOrigins = [
  process.env.BETTER_AUTH_URL,
  process.env.NEXT_PUBLIC_APP_URL,
].filter((origin): origin is string => Boolean(origin));

export const auth = betterAuth({
  appName: "CivicRelay",
  ...(process.env.BETTER_AUTH_SECRET
    ? { secret: process.env.BETTER_AUTH_SECRET }
    : {}),
  ...(process.env.BETTER_AUTH_URL
    ? { baseURL: process.env.BETTER_AUTH_URL }
    : {}),
  trustedOrigins,
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.authSessions,
      account: schema.authAccounts,
      verification: schema.authVerifications,
    },
  }),
  user: {
    fields: {
      name: "displayName",
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your CivicRelay password",
        text: passwordResetEmailText(url),
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your CivicRelay email address",
        text: verificationEmailText(url),
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
