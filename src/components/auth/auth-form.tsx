"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth/client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

export function AuthForm({ mode }: AuthFormProps) {
  const isSignUp = mode === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setStatus("");

    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          callbackURL: "/dashboard",
        });

        if (result.error) {
          setError(result.error.message ?? "Impossible de créer le compte.");
        } else {
          setStatus("Compte créé. Consultez votre boîte e-mail pour vérifier votre adresse avant de vous connecter.");
        }
      } else {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: "/dashboard",
        });

        if (result.error) {
          setError(result.error.message ?? "Connexion impossible. Vérifiez vos identifiants.");
        }
      }
    } catch {
      setError("Le service d’authentification est temporairement indisponible. Réessayez plus tard.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-12">
      <div className="grid w-full overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(23,35,33,0.08)] md:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden bg-[#123f35] p-12 text-white md:flex">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
          <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full border border-white/10" />
          <div className="relative">
            <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold tracking-wide">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-lg">C</span>
              CivicRelay
            </Link>
          </div>
          <div className="relative max-w-md">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">Emergency communication infrastructure</p>
            <h1 className="text-4xl font-semibold leading-[1.12] tracking-tight">
              Clear information.
              <br />
              Safer action.
            </h1>
            <p className="mt-6 max-w-sm text-base leading-7 text-emerald-50/75">
              Turn authoritative alerts into accessible public guidance, with human review at every critical step.
            </p>
          </div>
          <p className="relative text-xs text-emerald-100/60">CivicRelay does not issue official emergency warnings.</p>
        </section>

        <section className="flex min-h-[620px] flex-col justify-center px-6 py-12 sm:px-12">
          <div className="mx-auto w-full max-w-sm">
            <Link href="/" className="mb-10 inline-flex items-center gap-2 text-sm font-semibold text-brand md:hidden">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">C</span>
              CivicRelay
            </Link>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
              {isSignUp ? "Create an account" : "Secure workspace"}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              {isSignUp ? "Join CivicRelay" : "Welcome back"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              {isSignUp
                ? "Create your identity. An organization administrator must grant access separately."
                : "Sign in to continue to your organization workspace."}
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {isSignUp && (
                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-medium">Full name</label>
                  <input
                    id="name"
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                  />
                </div>
              )}
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium">Work email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  required
                  minLength={isSignUp ? 12 : 1}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                />
                {isSignUp && <p className="mt-2 text-xs text-muted">12 characters minimum.</p>}
              </div>

              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
              {status && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{status}</p>}

              <button
                type="submit"
                disabled={pending}
                className="flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-strong focus:outline-none focus:ring-4 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-muted">
              {isSignUp ? "Already have an account?" : "New to CivicRelay?"}{" "}
              <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="font-semibold text-brand hover:underline">
                {isSignUp ? "Sign in" : "Create an account"}
              </Link>
            </p>
            <p className="mt-8 border-t border-border pt-6 text-xs leading-5 text-muted">
              Access to emergency operations is controlled by organization membership and assigned roles. Creating an account does not grant operational permissions.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
