import Link from "next/link";
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { listActiveMembershipsForUser } from "@/lib/db/repositories/user-memberships";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const metadata: Metadata = {
  title: "Workspace",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const memberships = await listActiveMembershipsForUser(session.user.id);

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <Link href="/" className="text-sm font-semibold text-brand">CivicRelay</Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Workspace</h1>
            <p className="mt-1 text-sm text-muted">Signed in as {session.user.email}</p>
          </div>
          <SignOutButton />
        </header>

        <section className="mt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Organization access</p>
          <h2 className="mt-2 text-xl font-semibold">Your organizations</h2>
          {memberships.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-border bg-surface p-6">
              <h3 className="font-semibold">No organization access yet</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Your account is active, but it has not been assigned to an organization. An authorized CivicRelay organization administrator must invite you and activate your membership before you can view or manage emergency alerts.
              </p>
            </div>
          ) : (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {memberships.map(({ membership, organization }) => (
                <li key={membership.id} className="rounded-2xl border border-border bg-surface p-5">
                  <h3 className="font-semibold">{organization.name}</h3>
                  <p className="mt-2 text-sm text-muted">Role: {membership.role}</p>
                  <p className="mt-1 text-xs text-muted">Membership: {membership.status}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
