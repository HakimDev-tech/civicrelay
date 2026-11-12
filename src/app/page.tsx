export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
      <header className="flex items-center justify-between border-b border-border pb-6">
        <a aria-label="CivicRelay home" className="flex items-center gap-3" href="/">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white">
            C
          </span>
          <span className="text-lg font-semibold tracking-tight">CivicRelay</span>
        </a>
        <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted">
          Foundation build
        </span>
      </header>

      <section className="grid flex-1 content-center gap-8 py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="max-w-2xl">
          <p className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-brand">
            <span aria-hidden="true" className="size-2 rounded-full bg-signal" />
            Emergency communication, made actionable
          </p>
          <h1 className="text-5xl leading-[1.06] font-semibold tracking-[-0.055em] sm:text-6xl">
            Clear information.
            <span className="block text-brand">Safer action.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted">
            Official warnings only work when people can understand them. CivicRelay
            helps response teams prepare accessible, multilingual guidance—with
            human review at every critical step.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white">
              Human-approved communication
            </span>
            <span className="rounded-full border border-border bg-surface px-5 py-3 text-sm font-semibold text-foreground">
              CAP-ready foundation
            </span>
          </div>
        </div>

        <aside className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Communication workflow</p>
            <span className="rounded-full bg-[#e7f3ed] px-3 py-1 text-xs font-semibold text-brand">
              Human in the loop
            </span>
          </div>
          <ol className="mt-8 space-y-6">
            {[
              ["01", "Receive official alert", "Preserve the original CAP message."],
              ["02", "Prepare public guidance", "Make the information clear and accessible."],
              ["03", "Review and approve", "An authorized person checks every version."],
              ["04", "Publish and listen", "Collect acknowledgements and requests for help."],
            ].map(([number, title, description]) => (
              <li className="flex gap-4" key={number}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#edf4f0] text-xs font-bold text-brand">
                  {number}
                </span>
                <div>
                  <h2 className="text-sm font-semibold">{title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <footer className="flex flex-col gap-2 border-t border-border py-6 text-xs leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} CivicRelay</span>
        <span>CivicRelay does not issue official emergency warnings.</span>
      </footer>
    </main>
  );
}
