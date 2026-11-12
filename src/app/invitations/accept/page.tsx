import Link from "next/link";
import type { Metadata } from "next";
import { AcceptInvitationForm } from "@/components/auth/accept-invitation-form";
import { getCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Accept organization invitation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token || token.length < 32 || token.length > 256) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="max-w-lg rounded-3xl border border-border bg-surface p-8">
          <h1 className="text-2xl font-semibold">Invitation link unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-muted">The invitation link is incomplete or invalid. Ask your organization administrator to issue a new invitation.</p>
          <Link href="/" className="mt-6 inline-flex text-sm font-semibold text-brand hover:underline">Return to CivicRelay</Link>
        </div>
      </main>
    );
  }

  const session = await getCurrentSession();
  if (!session) {
    const callbackURL = `/invitations/accept?token=${encodeURIComponent(token)}`;
    return (
      <main className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="max-w-lg rounded-3xl border border-border bg-surface p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Organization invitation</p>
          <h1 className="mt-3 text-3xl font-semibold">Sign in to continue</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Sign in or create an account with the email address that received this invitation. You must verify that email before accepting.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={`/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`} className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white">Sign in</Link>
            <Link href={`/sign-up?callbackURL=${encodeURIComponent(callbackURL)}`} className="rounded-xl border border-border px-5 py-3 text-sm font-semibold">Create account</Link>
          </div>
        </div>
      </main>
    );
  }

  if (!session.user.emailVerified) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="max-w-lg rounded-3xl border border-border bg-surface p-8">
          <h1 className="text-2xl font-semibold">Verify your email first</h1>
          <p className="mt-3 text-sm leading-6 text-muted">CivicRelay requires a verified email address before organization access can be activated. Check your inbox for the verification link, then return to this invitation.</p>
          <p className="mt-4 text-sm text-muted">Signed in as {session.user.email}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <AcceptInvitationForm token={token} email={session.user.email} />
    </main>
  );
}
