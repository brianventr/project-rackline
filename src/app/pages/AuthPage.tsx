import { useState } from "react";
import { Link } from "react-router-dom";
import { api, authClient } from "../api";
import { Button, Card, ErrorBanner, Field, Input, onSubmit } from "../components/ui";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message || "Sign in failed");
      } else {
        const res = await fetch("/api/register", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, organizationName }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error || "Sign up failed");
        }
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    setError(null);
    setBusy(true);
    try {
      const demo = await api<{ email: string; password: string }>("/api/demo/seed", { method: "POST" });
      const result = await authClient.signIn.email({
        email: demo.email,
        password: demo.password,
      });
      if (result.error) throw new Error(result.error.message || "Demo sign in failed");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load demo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink text-paper">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[42%] bg-[repeating-linear-gradient(90deg,rgba(227,160,8,0.08)_0,rgba(227,160,8,0.08)_12px,transparent_12px,transparent_44px)]" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-amber">Project Rackline</p>
          <h1 className="mt-4 max-w-lg text-4xl font-semibold leading-tight">
            Warehouse software that starts with one aisle and stays with you.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-paper/70">
            Receive parts, pick Shopify orders, and complete work orders against a real inventory ledger.
            Built for makers who become manufacturers.
          </p>
        </div>
        <Card className="text-ink">
          <div className="mb-5 flex gap-2">
            <button
              className={`rounded-full px-3 py-1 text-sm ${mode === "login" ? "bg-ink text-paper" : "text-muted"}`}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              className={`rounded-full px-3 py-1 text-sm ${mode === "signup" ? "bg-ink text-paper" : "text-muted"}`}
              onClick={() => setMode("signup")}
            >
              Create org
            </button>
          </div>
          <ErrorBanner error={error} />
          <form className="space-y-3" onSubmit={onSubmit(submit)}>
            {mode === "signup" ? (
              <>
                <Field label="Your name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </Field>
                <Field label="Organization">
                  <Input
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Northwind Makers"
                    required
                  />
                </Field>
              </>
            ) : null}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Working…" : mode === "login" ? "Enter warehouse" : "Open the floor"}
            </Button>
          </form>
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-3 text-xs text-muted">Want a stocked shop instead of an empty one?</p>
            <Button variant="secondary" onClick={loadDemo} disabled={busy}>
              Load Northwind Makers demo
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted">
            Iteration 1: bins, receipts, picks, shipments, BOMs, work orders, and Shopify fulfill-back.
            <Link className="ml-1 underline" to="/">
              Skip if already signed in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
