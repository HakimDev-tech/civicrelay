"use client";

import { useState, type FormEvent } from "react";

export function OrganizationInviteForm({ organizationId }: { organizationId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/organizations/${organizationId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "Invitation could not be sent.");
        return;
      }
      setMessage(`Invitation sent to ${result.data.email}. It expires in seven days.`);
      setEmail("");
    } catch {
      setError("Invitation service is temporarily unavailable. Try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 rounded-2xl border border-border bg-background p-4">
      <p className="text-sm font-semibold">Invite a team member</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
        <label className="sr-only" htmlFor={`invite-email-${organizationId}`}>Work email</label>
        <input
          id={`invite-email-${organizationId}`}
          type="email"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@organization.org"
          className="min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
        />
        <label className="sr-only" htmlFor={`invite-role-${organizationId}`}>Assigned role</label>
        <select
          id={`invite-role-${organizationId}`}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
        >
          <option value="admin">Administrator</option>
          <option value="editor">Editor</option>
          <option value="reviewer">Reviewer</option>
          <option value="publisher">Publisher</option>
          <option value="reader">Reader</option>
        </select>
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <p className="mt-3 text-xs leading-5 text-muted">The invitee must sign in with this email address and verify it before accepting. Owner privileges cannot be assigned through invitations.</p>
    </form>
  );
}
