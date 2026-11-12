"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CapImportForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!file) {
      setError("Select a CAP XML file first.");
      return;
    }
    if (file.size < 1 || file.size > 1_048_576) {
      setError("The XML file must be between 1 byte and 1 MiB.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/alerts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/cap+xml" },
        credentials: "same-origin",
        body: file,
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error?.message ?? "The CAP message could not be imported.");
        return;
      }

      const data = result.data;
      setMessage(`CAP ${data.version.messageType.toLowerCase()} imported as version ${data.version.versionNumber}. Status: ${data.alert.status}.`);
      setFile(null);
      const input = document.getElementById(`cap-file-${organizationId}`) as HTMLInputElement | null;
      if (input) input.value = "";
      router.refresh();
    } catch {
      setError("The import service is temporarily unavailable. Try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">CAP 1.2 intake</p>
        <h2 className="mt-2 text-xl font-semibold">Import an official alert</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Upload the original CAP XML received from an authoritative source. CivicRelay validates and stores it as a draft or reviewable update; it does not publish automatically.
        </p>
      </div>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor={`cap-file-${organizationId}`} className="mb-2 block text-sm font-medium">CAP XML file</label>
          <input
            id={`cap-file-${organizationId}`}
            type="file"
            accept=".xml,application/xml,text/xml,application/cap+xml"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand"
          />
          <p className="mt-2 text-xs text-muted">Maximum 1 MiB. The original file bytes are sent unchanged.</p>
        </div>
        <button
          type="submit"
          disabled={pending || !file}
          className="rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Validating and importing…" : "Import CAP message"}
        </button>
      </form>
      {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    </section>
  );
}
