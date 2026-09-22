import { useEffect, useState } from "react";
import { api, type OperatorCertification, type TeamMember } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../../components/ui";
import { FLOOR_VERBS, VERB_LABELS, type FloorVerb } from "@/domain/jobs";
import { EQUIPMENT_CLASSES, equipmentClassLabel } from "@/domain/equipment";
import { formatExpiresOn } from "@/domain/expiry";
import { inviteOwnerMessage, type InviteKind } from "@/domain/auth-mail";

export function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [certs, setCerts] = useState<OperatorCertification[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");
  const [certUserId, setCertUserId] = useState("");
  const [certClass, setCertClass] = useState<(typeof EQUIPMENT_CLASSES)[number]>("sit_down");
  const [expiresOn, setExpiresOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    const [nextMembers, nextCerts] = await Promise.all([
      api<TeamMember[]>("/api/team"),
      api<OperatorCertification[]>("/api/certifications"),
    ]);
    setMembers(nextMembers);
    setCerts(nextCerts);
    if (!certUserId && nextMembers[0]) setCertUserId(nextMembers[0].userId);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function invite() {
    setError(null);
    setOk(null);
    try {
      const created = await api<TeamMember & { invite?: InviteKind }>("/api/team", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          role,
          password: password.trim() || undefined,
        }),
      });
      setName("");
      setEmail("");
      setPassword("");
      setOk(inviteOwnerMessage(created.invite ?? "password", created.name, created.email));
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

  async function addCert() {
    setError(null);
    try {
      await api("/api/certifications", {
        method: "POST",
        body: JSON.stringify({ userId: certUserId, class: certClass, expiresOn }),
      });
      setExpiresOn("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add certification");
    }
  }

  async function removeCert(id: string) {
    setError(null);
    try {
      await api(`/api/certifications/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove certification");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Team"
        description="Owners see setup. Operators land on the floor. Leave starter password blank to email a set-password link (needs mail)."
      />
      <ErrorBanner error={error} />
      {ok ? <p className="mb-3 text-sm text-emerald-700">{ok}</p> : null}
      <Card className="mb-3">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(invite)}>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Starter password (optional)">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              placeholder="Email a reset link instead"
            />
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
            <td className="px-2.5 py-1.5">{member.name}</td>
            <td className="px-2.5 py-1.5">{member.email}</td>
            <td className="px-2.5 py-1.5 capitalize">{member.role}</td>
            <td className="px-2.5 py-1.5">
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
      <div className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Equipment certifications</h2>
        <Card className="mb-3">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(addCert)}>
            <Field label="Teammate">
              <Select value={certUserId} onChange={(e) => setCertUserId(e.target.value)}>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Class">
              <Select
                value={certClass}
                onChange={(e) => setCertClass(e.target.value as (typeof EQUIPMENT_CLASSES)[number])}
              >
                {EQUIPMENT_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {equipmentClassLabel(value)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expires">
              <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Add cert</Button>
            </div>
          </form>
        </Card>
        <Table columns={["Teammate", "Class", "Expires", ""]}>
          {certs.map((cert) => (
            <tr key={cert.id}>
              <td className="px-2.5 py-1.5">{cert.userName}</td>
              <td className="px-2.5 py-1.5">{equipmentClassLabel(cert.class)}</td>
              <td className="px-2.5 py-1.5 font-mono text-sm">{formatExpiresOn(cert.expiresOn)}</td>
              <td className="px-2.5 py-1.5">
                <Button variant="ghost" onClick={() => void removeCert(cert.id)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
