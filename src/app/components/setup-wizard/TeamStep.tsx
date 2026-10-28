import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, UserPlus, Users } from "lucide-react";
import { api, type TeamMember } from "@/app/api";
import { ErrorBanner, Field, Input } from "@/app/components/ui";
import { refreshApi, useApiQuery } from "@/app/query";
import { useWrite } from "@/app/use-write";
import { inviteOwnerMessage } from "@/domain/auth-mail";
import { Button } from "@/components/ui/button";

const ROLES = [
  { value: "operator", label: "Operator", hint: "Receives, moves, picks, packs, and ships. A useful default for your warehouse team." },
  { value: "picker", label: "Picker", hint: "A focused Next job screen for the people completing assigned floor work." },
  { value: "bookkeeper", label: "Bookkeeper", hint: "Purchases and costs for someone handling the office books." },
  { value: "owner", label: "Owner", hint: "Full setup and administration. Give this role only to people responsible for the workspace." },
] as const;

type TeamRole = (typeof ROLES)[number]["value"];

/** A real team write, kept separate from the building's review-and-create plan. */
export function TeamStep() {
  const members = useApiQuery<TeamMember[]>("/api/team");
  const write = useWrite();
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("operator");
  const [method, setMethod] = useState<"password" | "email">("password");
  // A starter password exists only in this mounted form, never in the wizard's saved draft.
  const [password, setPassword] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const error = write.error?.includes("MAIL_") || write.error?.includes("MAIL_UNAVAILABLE")
    ? "Email invitations are not available for this workspace. Choose a starter password, or configure invitation email before trying again."
    : write.error;

  async function addTeammate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSuccess(null);
    try {
      const created = await write.run(
        "Add teammate",
        () => api<TeamMember>("/api/team", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), email: email.trim(), role, password: method === "password" ? password : undefined }),
        }),
      );
      if (!created) return;
      setSuccess(inviteOwnerMessage(created.invite ?? "password", created.name, created.email));
      setName("");
      setEmail("");
      setPassword("");
      void refreshApi("/api/team");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <Users aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="space-y-1">
            <h3 className="text-base font-semibold">One login for each person</h3>
            <p className="text-sm text-muted-foreground">
              Named accounts let you assign jobs and see who received, picked, packed, or moved stock. Add your team before handing out floor work; avoid a shared warehouse login.
            </p>
            <p className="text-sm text-muted-foreground">Working alone? Your owner account can do the work. Continue and invite people later.</p>
          </div>
        </div>
      </div>

      <section aria-labelledby="wizard-current-team" className="space-y-2">
        <h3 id="wizard-current-team" className="text-sm font-semibold">Already on your team</h3>
        {members.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading your team…</p> : null}
        {members.error ? (
          <div className="space-y-2">
            <ErrorBanner error="Your team could not be loaded. Try again before adding someone who may already have an account." />
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void members.refetch()}>Reload team</Button>
          </div>
        ) : null}
        {members.data?.length ? (
          <ul className="divide-y rounded-xl border bg-card" aria-label="Current team">
            {members.data.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{member.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{member.email}</p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{ROLES.find((option) => option.value === member.role)?.label ?? member.role}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <form onSubmit={addTeammate} className="space-y-4 rounded-xl border p-4" aria-label="Add a teammate during setup">
        <div>
          <h3 className="text-base font-semibold">Add a teammate</h3>
          <p className="mt-1 text-sm text-muted-foreground">This adds the person now. Moving between wizard steps or creating the building never sends an invitation.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Teammate name">
            <Input className="h-11 text-base md:text-base" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={200} disabled={write.busy} />
          </Field>
          <Field label="Teammate email">
            <Input className="h-11 text-base md:text-base" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={254} disabled={write.busy} />
          </Field>
        </div>
        <Field label="Role">
          <select className="h-11 w-full rounded-md border bg-background px-3 text-base" value={role} onChange={(event) => setRole(event.target.value as TeamRole)} disabled={write.busy}>
            {ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <p className="text-sm text-muted-foreground">{ROLES.find((option) => option.value === role)?.hint}</p>
        <Field label="How should they sign in?">
          <select
            className="h-11 w-full rounded-md border bg-background px-3 text-base"
            value={method}
            disabled={write.busy}
            onChange={(event) => {
              setMethod(event.target.value as "password" | "email");
              setPassword("");
              write.setError(null);
            }}
          >
            <option value="password">Give them a starter password</option>
            <option value="email">Email a set-password invitation</option>
          </select>
        </Field>
        {method === "password" ? (
          <div className="space-y-2">
            <Field label="Starter password">
              <Input className="h-11 text-base md:text-base" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} disabled={write.busy} />
            </Field>
            <p className="text-sm text-muted-foreground">Use at least 8 characters and share the password privately. It is not saved in this setup draft.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Requires invitation email to be configured for your workspace. The invitation is sent only when you press Send invitation.</p>
        )}
        <ErrorBanner error={error} />
        {success ? <p role="status" className="flex items-start gap-2 text-sm text-tone-success"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />{success}</p> : null}
        <Button type="submit" className="min-h-11" disabled={write.busy || !members.data || Boolean(members.error)}>
          {write.busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <UserPlus aria-hidden className="size-4" />}
          {write.busy ? "Adding teammate…" : method === "email" ? "Send invitation" : "Add teammate"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">Manage floor permissions, team activity, and equipment certifications later in <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/setup/team">Settings → Team</Link>.</p>
    </div>
  );
}
