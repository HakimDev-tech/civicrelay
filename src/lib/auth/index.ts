import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { getDb, schema } from "@/lib/db";
import {
  passwordResetEmailText,
  sendAuthEmail,
  verificationEmailText,
} from "./email";

const trustedOrigins = [process.env.BETTER_AUTH_URL].filter(
  (origin): origin is string => Boolean(origin),
);

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  }

  return betterAuth({
    appName: "CivicRelay",
    secret,
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
        rateLimit: schema.authRateLimits,
      },
    }),
    user: {
      fields: {
        name: "displayName",
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) {
              throw new Error("Account registration is unavailable until transactional email is configured.");
            }
          },
        },
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
        maxAge: 60,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limits",
      window: 60,
      max: 10,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/forget-password": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
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
}

type AuthInstance = ReturnType<typeof createAuth>;
type AuthGlobal = typeof globalThis & { __civicRelayAuth?: AuthInstance };
const authGlobal = globalThis as AuthGlobal;

export function getAuth(): AuthInstance {
  return authGlobal.__civicRelayAuth ?? (authGlobal.__civicRelayAuth = createAuth());
}

export type AuthSession = AuthInstance["$Infer"]["Session"];
