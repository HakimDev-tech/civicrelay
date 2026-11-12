import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicAlertResponseForm } from "@/components/alerts/public-alert-response-form";
import { getPublicAlertByToken } from "@/lib/db/repositories/publication-workflow";

export const metadata: Metadata = {
  title: "Public safety alert",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
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

export default async function PublicAlertPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  const alert = await getPublicAlertByToken(token);
  if (!alert) notFound();

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-sm font-bold tracking-tight text-brand">CivicRelay</p>
            <p className="mt-1 text-xs text-muted">Public emergency information</p>
          </div>
          <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold">Published alert</span>
        </header>

        <section className="mt-8 rounded-3xl border border-border bg-surface p-6 shadow-[0_20px_70px_rgba(23,35,33,0.06)] sm:p-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Issued by {alert.organizationName}</p>
            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800">{alert.severity} severity</span>
          </div>

          <div className="mt-7 rounded-2xl border border-border bg-background p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Français</p>
            <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{alert.headlineFr ?? "Alerte de sécurité"}</h1>
            <p className="mt-5 whitespace-pre-wrap text-base leading-8">{alert.descriptionFr ?? "Aucune description en français n’a été fournie."}</p>
            {alert.instructionFr && (
              <div className="mt-6 rounded-xl border border-brand/20 bg-brand/5 p-4">
                <h2 className="text-sm font-bold text-brand">Consignes à suivre</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{alert.instructionFr}</p>
              </div>
            )}
          </div>

          <div dir="rtl" className="mt-4 rounded-2xl border border-border bg-background p-5 text-right sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">العربية</p>
            <h2 className="mt-3 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{alert.headlineAr ?? "تنبيه للسلامة العامة"}</h2>
            <p className="mt-5 whitespace-pre-wrap text-base leading-8">{alert.descriptionAr ?? "لم يتم توفير وصف باللغة العربية."}</p>
            {alert.instructionAr && (
              <div className="mt-6 rounded-xl border border-brand/20 bg-brand/5 p-4">
                <h3 className="text-sm font-bold text-brand">التعليمات الواجب اتباعها</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-8">{alert.instructionAr}</p>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-xs text-muted">Urgency</p><p className="mt-1 text-sm font-semibold">{alert.urgency}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-xs text-muted">Effective</p><p className="mt-1 text-sm font-semibold">{formatDate(alert.effectiveAt)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-xs text-muted">Expires</p><p className="mt-1 text-sm font-semibold">{formatDate(alert.expiresAt)}</p>
            </div>
          </div>

          <p className="mt-6 text-xs leading-5 text-muted">
            This public guidance is an accessible adaptation of an authoritative CAP alert, published by {alert.organizationName} after human review. CivicRelay does not originate official warnings and does not replace emergency services. If you are in immediate danger, contact the relevant local emergency service directly.
          </p>
        </section>

        <div className="mt-6">
          <PublicAlertResponseForm token={token} />
        </div>

        <footer className="mt-8 border-t border-border pt-5 text-center text-xs leading-5 text-muted">
          CivicRelay · Understand the information. Take appropriate action. Share only verified guidance.
        </footer>
      </div>
    </main>
  );
}
