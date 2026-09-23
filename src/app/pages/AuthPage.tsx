import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { FieldErrors } from "react-hook-form";
import { z } from "zod";
import { api, ApiError, authClient, errorText } from "../api";
import { Button, ErrorBanner } from "../components/ui";
import { TextField, useZodForm, type ZodFormInput, type ZodFormOutput } from "../components/form-kit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/domain/form-schemas";

type AuthMode = "login" | "signup" | "forgot";

/** Better Auth's default `maxPasswordLength` (src/lib/auth.ts keeps the defaults). */

/** Better Auth checks every email with `z.email()` (sign in, sign up, and password reset). */
function emailProblem(value: string): string | null {
  if (!value.trim()) return "Enter your email.";
  if (!z.email().safeParse(value.trim()).success) return "Enter a full email, like sam@example.com.";
  return null;
}

/**
 * What the server accepts for each mode:
 * - Sign in: an email and any password (Better Auth checks it against the account).
 * - Create org: POST /api/register (`src/routes/register.ts`) needs a name, an email, and an
 *   organization; it trims the password, then it must be 8 to 128 characters.
 * - Reset: an email.
 */
function authFormSchema(mode: AuthMode) {
  return z
    .object({
      name: z.string(),
      organizationName: z.string(),
      email: z.string(),
      password: z.string(),
    })
    .superRefine((values, ctx) => {
      const flag = (path: "name" | "organizationName" | "email" | "password", message: string) =>
        ctx.addIssue({ code: "custom", message, path: [path], input: values[path] });
      if (mode === "signup") {
        if (!values.name.trim()) flag("name", "Enter your name.");
        if (!values.organizationName.trim()) flag("organizationName", "Enter a name for your organization.");
      }
      const email = emailProblem(values.email);
      if (email) flag("email", email);
      if (mode === "login" && !values.password) flag("password", "Enter your password.");
      if (mode === "signup") {
        const password = values.password.trim();
        if (!password) flag("password", "Choose a password.");
        else if (password.length < MIN_PASSWORD_LENGTH) {
          flag("password", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        } else if (password.length > MAX_PASSWORD_LENGTH) {
          flag("password", `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`);
        }
      }
    });
}

/** Better Auth's sign-in refusal in plain words; anything else shows as Better Auth words it. */
function signInProblem(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") {
    return "That email and password do not match. Check both, or reset the password.";
  }
  return error.message || fallback;
}

type AuthFormValues = ZodFormOutput<ReturnType<typeof authFormSchema>>;
type AuthFormInput = ZodFormInput<ReturnType<typeof authFormSchema>>;

/** Top to bottom, as the fields sit on the card. */
const FIELD_ORDER = ["name", "organizationName", "email", "password"] as const;

export function AuthPage({ mode: initialMode = "login" }: { mode?: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const schema = useMemo(() => authFormSchema(mode), [mode]);
  const form = useZodForm(schema, { name: "", organizationName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // What was typed carries across modes; the inline messages start over.
  const { clearErrors } = form;
  useEffect(() => {
    clearErrors();
  }, [mode, clearErrors]);

  async function submit(values: AuthFormValues) {
    const { name, email, password, organizationName } = values;
    setError(null);
    setBusy(true);
    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) throw new Error(result.error.message || "Could not send the reset email.");
        setResetSent(true);
        return;
      }
      if (mode === "login") {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error(signInProblem(result.error, "Could not sign in."));
      } else {
        const res = await fetch("/api/register", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, organizationName }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new ApiError(data.error || "Could not create the organization.", res.status, data);
        }
      }
      window.location.assign("/");
    } catch (err) {
      setError(errorText(err, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  }

  /** Focus the top field with a message. (The form's own pick follows the order fields first appeared,
   * so after switching to Create org it would land on Email instead of Your name.) */
  function focusFirstProblem(errors: FieldErrors<AuthFormInput>) {
    const first = FIELD_ORDER.find((name) => errors[name]);
    if (first) form.setFocus(first);
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
      if (result.error) throw new Error(signInProblem(result.error, "Could not sign in to the demo."));
      window.location.assign("/");
    } catch (err) {
      setError(errorText(err, "Could not load the demo."));
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
            {error ? (
              <div className="mb-3">
                <ErrorBanner error={error} />
              </div>
            ) : null}
            {mode === "forgot" && resetSent ? (
              <p className="text-sm text-muted-foreground">
                If that email is on a warehouse, we sent a reset link. Check the inbox, then{" "}
                <button type="button" className="underline" onClick={() => setMode("login")}>
                  sign in
                </button>
                .
              </p>
            ) : (
              <form className="grid gap-3" onSubmit={form.handleSubmit(submit, focusFirstProblem)}>
                {mode === "signup" ? (
                  <>
                    <TextField form={form} name="name" label="Your name" autoComplete="name" />
                    <TextField
                      form={form}
                      name="organizationName"
                      label="Organization"
                      placeholder="Northwind Makers"
                      autoComplete="organization"
                    />
                  </>
                ) : null}
                <TextField form={form} name="email" label="Email" type="email" autoComplete="email" />
                {mode !== "forgot" ? (
                  <TextField
                    form={form}
                    name="password"
                    label="Password"
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
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
