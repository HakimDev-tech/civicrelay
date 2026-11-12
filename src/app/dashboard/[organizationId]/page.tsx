import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CapImportForm } from "@/components/alerts/cap-import-form";
import { requireSession } from "@/lib/auth/session";
import { listAlerts } from "@/lib/db/repositories/alerts";
import { listActiveMembershipsForUser } from "@/lib/db/repositories/user-memberships";

export const metadata: Metadata = {
  title: "Alert operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function formatDate(value: Date | null) {
  if (!value) return "Not specified";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value) + " UTC";
}

export default async function OrganizationWorkspacePage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const session = await requireSession();
  const memberships = await listActiveMembershipsForUser(session.user.id);
  const access = memberships.find((item) => item.organization.id === organizationId);
  if (!access) notFound();

  const alerts = await listAlerts({
    organizationId,
    membershipId: access.membership.id,
    limit: 100,
  });

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <Link href="/dashboard" className="text-sm font-semibold text-brand">← Workspace</Link>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{access.organization.name}</h1>
            <p className="mt-1 text-sm text-muted">Alert operations · {access.membership.role}</p>
          </div>
          <p className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted">{alerts.length} alert{alerts.length === 1 ? "" : "s"}</p>
        </header>

        <div className="mt-8">
          {(access.membership.role === "owner" || access.membership.role === "admin" || access.membership.role === "editor") ? (
            <CapImportForm organizationId={organizationId} />
          ) : (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="font-semibold">Read-only access</h2>
              <p className="mt-2 text-sm text-muted">Your current role can view alerts but cannot import new CAP messages.</p>
            </div>
          )}
        </div>

        <section className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Operational feed</p>
              <h2 className="mt-2 text-2xl font-semibold">Alerts</h2>
            </div>
            <p className="text-xs text-muted">Most recently updated first</p>
          </div>

          {alerts.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
              <h3 className="font-semibold">No alerts imported yet</h3>
              <p className="mt-2 text-sm text-muted">Import an official CAP XML message to begin the review and publication workflow.</p>
            </div>
          ) : (
            <ul className="mt-5 grid gap-3">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <Link
                    href={`/dashboard/${organizationId}/alerts/${alert.id}`}
                    className="group block rounded-2xl border border-border bg-surface p-5 transition hover:border-brand/40 hover:shadow-[0_12px_35px_rgba(23,35,33,0.06)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold capitalize text-brand">{alert.status.replace("_", " ")}</span>
                        <span className="text-xs text-muted">{alert.severity} severity</span>
                      </div>
                      <span className="text-xs text-muted">{formatDate(alert.sentAt)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold group-hover:text-brand">{alert.sourceIdentifier}</p>
                        <p className="mt-1 text-xs text-muted">CAP sender: {alert.sourceSender}</p>
                      </div>
                      <span className="text-sm font-semibold text-brand">Review alert →</span>
                    </div>
                    <p className="mt-3 text-xs text-muted">Expires: {formatDate(alert.expiresAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
