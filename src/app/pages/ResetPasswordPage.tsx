import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "../api";
import { Button, ErrorBanner, Field, Input, onSubmit } from "../components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token")?.trim() || "", [params]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (!token) {
      setError("This reset link is missing a token. Request a new one from sign in.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) throw new Error(result.error.message || "Could not reset password");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted relative flex min-h-svh flex-col items-center justify-center gap-6 overflow-hidden p-6 md:p-10">
      <div className="absolute right-4 top-4 z-10">
        <ModeToggle />
      </div>
      <div className="relative z-10 flex w-full max-w-sm flex-col gap-6">
        <Link to="/" className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md">
            <Logo size={20} />
          </div>
          Rackline
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{done ? "Password updated" : "Choose a new password"}</CardTitle>
            <CardDescription>
              {done ? "Sign in with the new password to walk onto the floor." : "The link in your email expires soon."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ErrorBanner error={error} />
            {done ? (
              <Button asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            ) : (
              <form className="grid gap-3" onSubmit={onSubmit(submit)}>
                <Field label="New password">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </Field>
                <Field label="Confirm">
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={8}
                    required
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
