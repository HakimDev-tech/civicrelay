import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertWorkflowActions } from "@/components/alerts/alert-workflow-actions";
import { requireSession } from "@/lib/auth/session";
import { getAlertById, listAlertVersions } from "@/lib/db/repositories/alerts";
import { getLatestApprovalForVersion } from "@/lib/db/repositories/publication-workflow";
import { listActiveMembershipsForUser } from "@/lib/db/repositories/user-memberships";

export const metadata: Metadata = {
  title: "Alert review",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function formatDate(value: Date | null | undefined) {
  if (!value) return "Not specified";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value) + " UTC";
}

export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; alertId: string }>;
}) {
  const { organizationId, alertId } = await params;
  const session = await requireSession();
  const memberships = await listActiveMembershipsForUser(session.user.id);
  const access = memberships.find((item) => item.organization.id === organizationId);
  if (!access) notFound();

  const alert = await getAlertById({
    organizationId,
    membershipId: access.membership.id,
    alertId,
  });
  const versions = await listAlertVersions({
    organizationId,
    membershipId: access.membership.id,
    alertId,
  });
  const latest = versions[0];
  if (!latest) notFound();

  const latestApproval = await getLatestApprovalForVersion({
    organizationId,
    membershipId: access.membership.id,
    alertVersionId: latest.id,
  });

  const canReview = ["owner", "admin", "reviewer"].includes(access.membership.role);
  const canPublish = ["owner", "admin", "publisher"].includes(access.membership.role);
  const reviewable = latest.capMessageType !== "Cancel" &&
    alert.status !== "cancelled" && alert.status !== "expired" && alert.status !== "published";
  const publishable = latestApproval?.decision === "approved" &&
    alert.status === "approved" &&
    latest.capStatus === "Actual" &&
    (!alert.expiresAt || alert.expiresAt > new Date());

  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-border pb-6">
          <Link href={`/dashboard/${organizationId}`} className="text-sm font-semibold text-brand">← {access.organization.name}</Link>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Alert record</p>
              <h1 className="mt-2 break-all text-2xl font-semibold tracking-tight sm:text-3xl">{alert.sourceIdentifier}</h1>
              <p className="mt-2 text-sm text-muted">CAP sender: {alert.sourceSender}</p>
            </div>
            <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold capitalize">{alert.status.replace("_", " ")}</span>
          </div>
        </header>

        <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">Severity</p><p className="mt-1 font-semibold">{alert.severity}</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">Urgency</p><p className="mt-1 font-semibold">{alert.urgency}</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">Certainty</p><p className="mt-1 font-semibold">{alert.certainty}</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs text-muted">Expires</p><p className="mt-1 font-semibold">{formatDate(alert.expiresAt)}</p>
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Latest version · v{latest.versionNumber}</p>
                  <h2 className="mt-2 text-xl font-semibold">Public guidance adaptation</h2>
                </div>
                <span className="rounded-full bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand">{latest.capMessageType}</span>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <article className="rounded-xl border border-border bg-background p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">French</p>
                  <h3 className="mt-3 text-lg font-semibold">{latest.headlineFr ?? "No French headline in source"}</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{latest.descriptionFr ?? "No French description in source."}</p>
                  {latest.instructionFr && <div className="mt-4 rounded-lg bg-brand/5 p-3"><p className="text-xs font-semibold text-brand">Instructions</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{latest.instructionFr}</p></div>}
                </article>
                <article dir="rtl" className="rounded-xl border border-border bg-background p-4 text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">العربية</p>
                  <h3 className="mt-3 text-lg font-semibold">{latest.headlineAr ?? "لا يوجد عنوان عربي في المصدر"}</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{latest.descriptionAr ?? "لا يوجد وصف عربي في المصدر."}</p>
                  {latest.instructionAr && <div className="mt-4 rounded-lg bg-brand/5 p-3"><p className="text-xs font-semibold text-brand">التعليمات</p><p className="mt-1 whitespace-pre-wrap text-sm leading-7">{latest.instructionAr}</p></div>}
                </article>
              </div>
              <div className="mt-5 border-t border-border pt-4 text-xs text-muted">
                <p>CAP sent: {formatDate(latest.capSentAt)} · Source SHA-256: <span className="break-all font-mono">{latest.sourceSha256}</span></p>
                <p className="mt-2">The original CAP XML is retained unchanged. This view does not modify or replace the authoritative source message.</p>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-lg font-semibold">Version history</h2>
              <ol className="mt-4 space-y-3">
                {versions.map((version) => (
                  <li key={version.id} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">Version {version.versionNumber} · {version.capMessageType}</p>
                      <p className="text-xs text-muted">{formatDate(version.capSentAt)}</p>
                    </div>
                    <p className="mt-2 text-xs text-muted">CAP status: {version.capStatus} · SHA-256: <span className="break-all font-mono">{version.sourceSha256}</span></p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="space-y-4">
            <AlertWorkflowActions
              organizationId={organizationId}
              alertId={alertId}
              canReview={canReview}
              canPublish={canPublish}
              reviewable={reviewable}
              publishable={publishable}
            />
            <section className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Latest review</p>
              {latestApproval ? (
                <>
                  <p className="mt-3 text-lg font-semibold capitalize">{latestApproval.decision}</p>
                  <p className="mt-1 text-xs text-muted">{formatDate(latestApproval.createdAt)}</p>
                </>
              ) : (
                <p className="mt-3 text-sm leading-6 text-muted">No human review has been recorded for the latest version.</p>
              )}
              <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted">Only an authorized reviewer can approve or reject. Only an authorized publisher can publish an approved latest version.</p>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
