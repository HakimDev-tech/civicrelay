"use client";

import { useState, type FormEvent } from "react";

const acknowledgements = [
  { value: "received", label: "I received this alert" },
  { value: "understood", label: "I understand the guidance" },
  { value: "safe", label: "I am safe" },
  { value: "need_help", label: "I need help" },
] as const;

export function PublicAlertResponseForm({ token }: { token: string }) {
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [category, setCategory] = useState("need_help");
  const [message, setMessage] = useState("");

  async function acknowledge(type: (typeof acknowledgements)[number]["value"]) {
    setPending(type);
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/public/alerts/${token}/acknowledgements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ type }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "Your response could not be recorded.");
        return;
      }
      setStatus("Your response has been recorded. It does not contact emergency services.");
    } catch {
      setError("The response service is temporarily unavailable.");
    } finally {
      setPending("");
    }
  }

  async function sendFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("feedback");
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/public/alerts/${token}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ category, message: message.trim() || null }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "Your feedback could not be sent.");
        return;
      }
      setStatus("Your feedback has been recorded. Do not use this form for urgent emergency assistance.");
      setMessage("");
    } catch {
      setError("The feedback service is temporarily unavailable.");
    } finally {
      setPending("");
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Acknowledge this alert</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Share whether you received and understood this information. Responses are aggregated for the publishing organization.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {acknowledgements.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => acknowledge(item.value)}
              disabled={pending !== ""}
              className="rounded-xl border border-border bg-background px-4 py-3 text-left text-sm font-semibold transition hover:border-brand/50 hover:bg-brand/5 disabled:opacity-50"
            >
              {pending === item.value ? "Recording…" : item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Send feedback or request assistance</h2>
        <p className="mt-2 text-sm leading-6 text-muted">This message is sent to the publishing organization’s CivicRelay workspace. Do not include passwords, financial details, or unnecessary personal information.</p>
        <form onSubmit={sendFeedback} className="mt-4 space-y-3">
          <label htmlFor="feedback-category" className="block text-sm font-medium">Reason</label>
          <select
            id="feedback-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          >
            <option value="need_help">I need assistance</option>
            <option value="incorrect_information">Information may be incorrect</option>
            <option value="accessibility_issue">Accessibility issue</option>
            <option value="other">Other feedback</option>
          </select>
          <label htmlFor="feedback-message" className="block text-sm font-medium">Message (optional)</label>
          <textarea
            id="feedback-message"
            rows={4}
            maxLength={4000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe what you need the organization to know…"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
          <button
            type="submit"
            disabled={pending !== ""}
            className="rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending === "feedback" ? "Sending…" : "Send feedback"}
          </button>
        </form>
      </div>

      {status && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{status}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    </section>
  );
}
