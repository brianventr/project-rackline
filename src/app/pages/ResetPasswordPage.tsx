import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { authClient, errorText } from "../api";
import { Button, ErrorBanner } from "../components/ui";
import { TextField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/domain/form-schemas";

/** Better Auth's default `maxPasswordLength` (src/lib/auth.ts keeps the defaults). */

/** Better Auth `resetPassword`: the new password as typed must be 8 to 128 characters. */
const resetFormSchema = z
  .object({
    password: z.string(),
    confirm: z.string(),
  })
  .superRefine((values, ctx) => {
    if (!values.password) {
      ctx.addIssue({ code: "custom", message: "Choose a new password.", path: ["password"], input: values.password });
    } else if (values.password.length < MIN_PASSWORD_LENGTH) {
      ctx.addIssue({
        code: "custom",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        path: ["password"],
        input: values.password,
      });
    } else if (values.password.length > MAX_PASSWORD_LENGTH) {
      ctx.addIssue({
        code: "custom",
        message: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`,
        path: ["password"],
        input: values.password,
      });
    }
    if (!values.confirm) {
      ctx.addIssue({ code: "custom", message: "Type the new password again.", path: ["confirm"], input: values.confirm });
    } else if (values.confirm !== values.password) {
      ctx.addIssue({ code: "custom", message: "Passwords do not match.", path: ["confirm"], input: values.confirm });
    }
  });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token")?.trim() || "", [params]);
  const form = useZodForm(resetFormSchema, { password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Once Confirm has been filled in, changing the new password re-checks that they match.
  const password = form.watch("password");
  const { getFieldState, trigger } = form;
  useEffect(() => {
    if (getFieldState("confirm").isTouched) void trigger("confirm");
  }, [password, getFieldState, trigger]);

  async function save(values: ZodFormOutput<typeof resetFormSchema>) {
    setBusy(true);
    try {
      const result = await authClient.resetPassword({ newPassword: values.password, token });
      if (result.error) {
        throw new Error(
          result.error.code === "INVALID_TOKEN"
            ? "This reset link has expired or was already used. Request a new one from sign in."
            : result.error.message || "Could not reset the password.",
        );
      }
      setDone(true);
    } catch (err) {
      setError(errorText(err, "Could not reset the password."));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    setError(null);
    // A link without a token cannot work whatever is typed, so say that first.
    if (!token) {
      event.preventDefault();
      setError("This reset link is missing a token. Request a new one from sign in.");
      return;
    }
    void form.handleSubmit(save)(event);
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
            {error ? (
              <div className="mb-3">
                <ErrorBanner error={error} />
              </div>
            ) : null}
            {done ? (
              <Button asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            ) : (
              <form className="grid gap-3" onSubmit={submit}>
                <TextField form={form} name="password" label="New password" type="password" autoComplete="new-password" />
                <TextField form={form} name="confirm" label="Confirm" type="password" autoComplete="new-password" />
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
