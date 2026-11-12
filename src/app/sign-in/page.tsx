import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

function safeCallbackURL(value?: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  try {
    const parsed = new URL(value, "https://civicrelay.invalid");
    return parsed.origin === "https://civicrelay.invalid"
      ? \`\${parsed.pathname}\${parsed.search}\${parsed.hash}\`
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string }>;
}) {
  const { callbackURL: requestedCallback } = await searchParams;
  const callbackURL = safeCallbackURL(requestedCallback);
  return <AuthForm mode="sign-in" callbackURL={callbackURL} />;
}
