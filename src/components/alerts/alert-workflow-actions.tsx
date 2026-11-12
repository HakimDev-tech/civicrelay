"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AlertWorkflowActionsProps = {
  organizationId: string;
  alertId: string;
  canReview: boolean;
  canPublish: boolean;
  reviewable: boolean;
  publishable: boolean;
};

export function AlertWorkflowActions({
  organizationId,
  alertId,
  canReview,
  canPublish,
  reviewable,
  publishable,
}: AlertWorkflowActionsProps) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [publicUrl, setPublicUrl] = useState("");

  async function review(decision: "approved" | "rejected") {
    setPending(decision === "approved" ? "approve" : "reject");
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/organizations/${organizationId}/alerts/${alertId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ decision, comment: comment.trim() || null }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "The review decision could not be recorded.");
        return;
      }
      setStatus(decision === "approved" ? "Version approved. Publication is now available to an authorized publisher." : "Version rejected. The alert remains unpublished.");
      setComment("");
      router.refresh();
    } catch {
      setError("The review service is temporarily unavailable.");
    } finally {
      setPending(null);
    }
  }

  async function publish() {
    setPending("publish");
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/organizations/${organizationId}/alerts/${alertId}/publish`, {
        method: "POST",
        credentials: "same-origin",
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error?.message ?? "The alert could not be published.");
        return;
      }
      setPublicUrl(result.data.publicUrl);
      setStatus("Alert published. Copy and distribute the public link through your approved communication channels.");
      router.refresh();
    } catch {
      setError("The publication service is temporarily unavailable.");
    } finally {
      setPending(null);
    }
  }

  if (!canReview && !canPublish) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Human control</p>
      <h2 className="mt-2 text-xl font-semibold">Review and publication</h2>
      {canReview && reviewable && (
        <div className="mt-4">
          <label htmlFor="review-comment" className="mb-2 block text-sm font-medium">Review comment (optional)</label>
          <textarea
            id="review-comment"
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Record the reason for approval or rejection…"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => review("approved")}
              disabled={pending !== null}
              className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending === "approve" ? "Approving…" : "Approve this version"}
            </button>
            <button
              type="button"
              onClick={() => review("rejected")}
              disabled={pending !== null}
              className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-50"
            >
              {pending === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      )}
      {canPublish && publishable && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <p className="text-sm leading-6 text-muted">The latest version has an approved human review. Publishing creates a public, unguessable link; the link is shown only once here.</p>
          <button
            type="button"
            onClick={publish}
            disabled={pending !== null}
            className="mt-3 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending === "publish" ? "Publishing…" : "Publish approved alert"}
          </button>
        </div>
      )}
      {status && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{status}</p>}
      {publicUrl && (
        <div className="mt-3 rounded-xl border border-border bg-background p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">One-time public link</p>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm font-semibold text-brand underline">{publicUrl}</a>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(publicUrl)}
            className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-semibold"
          >
            Copy link
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {!reviewable && canReview && <p className="mt-3 text-sm text-muted">This alert version cannot be reviewed in its current state.</p>}
    </section>
  );
}
