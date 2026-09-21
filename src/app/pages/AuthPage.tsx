import { useState } from "react";
import { Link } from "react-router-dom";
import { api, authClient } from "../api";
import { Button, ErrorBanner, Field, Input, onSubmit } from "../components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";

export function AuthPage({ mode: initialMode = "login" }: { mode?: "login" | "signup" }) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
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
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="absolute right-4 top-4">
        <ModeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link to="/" className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md">
            <Logo size={20} />
          </div>
          Rackline
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{mode === "login" ? "Welcome back" : "Start in Garage Mode"}</CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Sign in to the floor board, map, and Shopify channel."
                : "A bench for founders and inventors. Open the full warehouse when you grow."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Button variant={mode === "login" ? "primary" : "ghost"} onClick={() => setMode("login")}>
                Sign in
              </Button>
              <Button variant={mode === "signup" ? "primary" : "ghost"} onClick={() => setMode("signup")}>
                Create org
              </Button>
            </div>
            <ErrorBanner error={error} />
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
                {busy ? "Working…" : mode === "login" ? "Enter warehouse" : "Open Garage Mode"}
              </Button>
            </form>
            <div className="mt-6 border-t pt-4">
              <p className="mb-3 text-xs text-muted-foreground">Want a stocked shop instead of an empty one?</p>
              <Button variant="secondary" onClick={() => void loadDemo()} disabled={busy}>
                Load Northwind Makers demo
              </Button>
            </div>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Demo login is demo@northwind.makers / rackline-demo after you seed.
        </p>
      </div>
    </div>
  );
}
