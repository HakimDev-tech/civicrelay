"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptInvitationForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function acceptInvitation() {
    setPending(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error?.message ?? "The invitation could not be accepted.");
        return;
      }

      setSuccess(`You now have ${result.data.role} access to ${result.data.organizationName}.`);
      router.refresh();
      router.replace("/dashboard");
    } catch {
      setError("The invitation service is temporarily unavailable. Try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="w-full max-w-xl rounded-3xl border border-border bg-surface p-7 shadow-[0_20px_70px_rgba(23,35,33,0.07)] sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Organization invitation</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Join your response team</h1>
      <p className="mt-4 text-sm leading-6 text-muted">
        This invitation is bound to <strong className="text-foreground">{email}</strong>. Accepting it grants only the role assigned by the organization administrator.
      </p>
      {error && <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {success && <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{success}</p>}
      <button
        type="button"
        onClick={acceptInvitation}
        disabled={pending}
        className="mt-8 flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-strong focus:outline-none focus:ring-4 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Accepting invitation…" : "Accept invitation"}
      </button>
    </section>
  );
}
