import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false },
};

function safeCallbackURL(value?: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  try {
    const parsed = new URL(value, "https://civicrelay.invalid");
    return parsed.origin === "https://civicrelay.invalid"
      ? parsed.pathname + parsed.search + parsed.hash
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[] }>;
}) {
  const { callbackURL: requestedCallback } = await searchParams;
  const callbackURL = safeCallbackURL(typeof requestedCallback === "string" ? requestedCallback : undefined);
  return <AuthForm mode="sign-up" callbackURL={callbackURL} />;
}
