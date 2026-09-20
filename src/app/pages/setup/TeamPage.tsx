import { useEffect, useState } from "react";
import { api, type TeamMember } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../../components/ui";
import { FLOOR_VERBS, VERB_LABELS, type FloorVerb } from "@/domain/jobs";

export function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setMembers(await api<TeamMember[]>("/api/team"));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function invite() {
    setError(null);
    try {
      await api("/api/team", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role }),
      });
      setName("");
      setEmail("");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite teammate");
    }
  }

  async function saveVerbs(userId: string, floorVerbs: FloorVerb[]) {
    setError(null);
    try {
      await api(`/api/team/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ floorVerbs }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update verbs");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Team"
        description="Owners see setup. Operators land on the floor. Optionally limit which floor verbs a person can be offered as next job."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(invite)}>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Starter password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="operator">Operator</option>
              <option value="owner">Owner</option>
            </Select>
          </Field>
          <div className="md:col-span-4">
            <Button type="submit">Invite</Button>
          </div>
        </form>
      </Card>
      <Table columns={["Name", "Email", "Role", "Floor verbs"]}>
        {members.map((member) => (
          <tr key={member.id}>
            <td className="px-4 py-3">{member.name}</td>
            <td className="px-4 py-3">{member.email}</td>
            <td className="px-4 py-3 capitalize">{member.role}</td>
            <td className="px-4 py-3">
              {member.role === "owner" ? (
                <p className="text-sm text-muted-foreground">All verbs</p>
              ) : (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {FLOOR_VERBS.map((verb) => {
                    const checked = (member.floorVerbs ?? FLOOR_VERBS).includes(verb);
                    return (
                      <label key={verb} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const current = (member.floorVerbs ?? [...FLOOR_VERBS]) as FloorVerb[];
                            const next = event.target.checked
                              ? [...new Set([...current, verb])]
                              : current.filter((row) => row !== verb);
                            if (next.length === 0) {
                              setError("Pick at least one floor verb");
                              return;
                            }
                            void saveVerbs(member.userId, next);
                          }}
                        />
                        {VERB_LABELS[verb]}
                      </label>
                    );
                  })}
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
