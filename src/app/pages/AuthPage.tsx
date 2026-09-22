import { useState } from "react";
import { Link } from "react-router-dom";
import { api, authClient } from "../api";
import { Button, ErrorBanner, Field, Input, onSubmit } from "../components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";

export function AuthPage({ mode: initialMode = "login" }: { mode?: "login" | "signup" | "forgot" }) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) throw new Error(result.error.message || "Could not send reset email");
        setResetSent(true);
        return;
      }
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

  const title =
    mode === "signup" ? "Start in Garage Mode" : mode === "forgot" ? "Reset your password" : "Welcome back";
  const description =
    mode === "signup"
      ? "A bench for founders and inventors. Open the full warehouse when you grow."
      : mode === "forgot"
        ? "We email a link if that address is on a warehouse."
        : "Sign in to the floor board, map, and Shopify channel.";

  return (
    <div className="bg-muted relative flex min-h-svh flex-col items-center justify-center gap-6 overflow-hidden p-6 md:p-10">
      <div className="pointer-events-none absolute -top-32 flex h-full w-full items-center justify-end">
        <div className="flex w-3/4 items-center justify-center">
          <div className="h-150 w-12 rounded-3xl bg-primary blur-[70px] will-change-transform max-sm:rotate-15 sm:rotate-35" />
        </div>
      </div>
      <div className="absolute right-4 top-4 z-10">
        <ModeToggle />
      </div>
      <div className="relative z-10 flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="w-fit rounded-full border border-border bg-card px-2 py-1 text-sm">Garage Mode</span>
          <p className="text-sm text-muted-foreground">A bench, a few shelves, and a real ledger.</p>
        </div>
        <Link to="/" className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md">
            <Logo size={20} />
          </div>
          Rackline
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            {mode !== "forgot" ? (
              <div className="mb-4 grid grid-cols-2 gap-2">
                <Button
                  variant={mode === "login" ? "primary" : "ghost"}
                  onClick={() => {
                    setMode("login");
                    setResetSent(false);
                  }}
                >
                  Sign in
                </Button>
                <Button
                  variant={mode === "signup" ? "primary" : "ghost"}
                  onClick={() => {
                    setMode("signup");
                    setResetSent(false);
                  }}
                >
                  Create org
                </Button>
              </div>
            ) : null}
            <ErrorBanner error={error} />
            {mode === "forgot" && resetSent ? (
              <p className="text-sm text-muted-foreground">
                If that email is on a warehouse, we sent a reset link. Check the inbox, then{" "}
                <button type="button" className="underline" onClick={() => setMode("login")}>
                  sign in
                </button>
                .
              </p>
            ) : (
              <form className="grid gap-3" onSubmit={onSubmit(submit)}>
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
                {mode !== "forgot" ? (
                  <Field label="Password">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </Field>
                ) : null}
                {mode === "login" ? (
                  <button
                    type="button"
                    className="justify-self-start text-xs text-muted-foreground underline"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setResetSent(false);
                    }}
                  >
                    Forgot password?
                  </button>
                ) : null}
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Working…"
                    : mode === "login"
                      ? "Enter warehouse"
                      : mode === "forgot"
                        ? "Send reset link"
                        : "Open Garage Mode"}
                </Button>
              </form>
            )}
            {mode === "forgot" && !resetSent ? (
              <button
                type="button"
                className="mt-4 text-xs text-muted-foreground underline"
                onClick={() => setMode("login")}
              >
                Back to sign in
              </button>
            ) : null}
            {mode !== "forgot" ? (
              <div className="mt-6 border-t pt-4">
                <p className="mb-3 text-xs text-muted-foreground">Want a stocked shop instead of an empty one?</p>
                <Button variant="secondary" onClick={() => void loadDemo()} disabled={busy}>
                  Load Northwind Makers demo
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Demo login is demo@northwind.makers / rackline-demo after you seed.
        </p>
      </div>
    </div>
  );
}
