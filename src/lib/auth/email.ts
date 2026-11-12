import "server-only";

type AuthEmailInput = {
  to: string;
  subject: string;
  text: string;
};

export async function sendAuthEmail({ to, subject, text }: AuthEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error("Authentication email delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Authentication email provider returned HTTP ${response.status}.`);
  }
}

export function verificationEmailText(url: string): string {
  return [
    "Verify your CivicRelay email address",
    "",
    "Use the following link to verify your email address:",
    url,
    "",
    "If you did not create a CivicRelay account, you can ignore this message.",
  ].join("\n");
}

export function passwordResetEmailText(url: string): string {
  return [
    "Reset your CivicRelay password",
    "",
    "Use the following link to choose a new password:",
    url,
    "",
    "If you did not request a password reset, you can ignore this message.",
  ].join("\n");
}
