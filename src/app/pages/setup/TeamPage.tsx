import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BadgeCheck, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { api, type OperatorCertification, type TeamMember } from "../../api";
import { Button, EmptyState, Field, Input, PageHeader, Select, ToneBadge } from "../../components/ui";
import { DataTable, type DataColumn, type FacetDef } from "../../components/data-table/DataTable";
import { Muted, PersonAvatar } from "../../components/cells";
import { ActionButton } from "../../components/document";
import { FormSheet } from "../../components/form-sheet";
import { apiMutate, useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import { Checkbox } from "@/components/ui/checkbox";
import { FLOOR_VERBS, VERB_LABELS, type FloorVerb } from "@/domain/jobs";
import { EQUIPMENT_CLASSES, equipmentClassLabel, isCertExpired, isCertExpiring } from "@/domain/equipment";
import { formatExpiresOn } from "@/domain/expiry";
import { inviteOwnerMessage, type InviteKind } from "@/domain/auth-mail";

type EquipmentClass = (typeof EQUIPMENT_CLASSES)[number];

function roleLabel(role: string): string {
  return role === "owner" ? "Owner" : role === "operator" ? "Operator" : role;
}

const MEMBER_FACETS: FacetDef<TeamMember>[] = [{ id: "role", label: "Role", value: (member) => member.role, format: roleLabel }];

const MEMBER_COLUMNS: DataColumn<TeamMember>[] = [
  {
    id: "name",
    header: "Teammate",
    sortValue: (member) => member.name,
    csv: (member) => `${member.name} <${member.email}>`,
    cell: (member) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <PersonAvatar name={member.name} className="size-7" />
        <span className="min-w-0">
          <span className="block truncate font-medium">{member.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
        </span>
      </span>
    ),
  },
  {
    id: "email",
    header: "Email",
    defaultHidden: true,
    sortValue: (member) => member.email,
    cell: (member) => member.email,
  },
  {
    id: "role",
    header: "Role",
    sortValue: (member) => member.role,
    cell: (member) => (
      <ToneBadge tone={member.role === "owner" ? "info" : "neutral"} dot={false}>
        {roleLabel(member.role)}
      </ToneBadge>
    ),
  },
  {
    id: "verbs",
    header: "Floor verbs",
    className: "min-w-[18rem]",
    csv: (member) => (member.role === "owner" ? "all" : (member.floorVerbs ?? FLOOR_VERBS).join(" ")),
    cell: (member) => <FloorVerbsCell member={member} />,
  },
];

type CertRow = OperatorCertification & { state: "ok" | "expiring" | "expired" };

const CERT_FACETS: FacetDef<CertRow>[] = [
  { id: "class", label: "Class", value: (cert) => cert.class, format: equipmentClassLabel },
  {
    id: "state",
    label: "State",
    value: (cert) => cert.state,
    format: (value) => (value === "ok" ? "Current" : value === "expiring" ? "Expiring soon" : "Expired"),
  },
];

const CERT_COLUMNS: DataColumn<CertRow>[] = [
  {
    id: "teammate",
    header: "Teammate",
    sortValue: (cert) => cert.userName ?? null,
    cell: (cert) => (
      <span className="flex min-w-0 items-center gap-2">
        <PersonAvatar name={cert.userName} />
        <span className="truncate">{cert.userName ?? <Muted>Unknown</Muted>}</span>
      </span>
    ),
  },
  {
    id: "class",
    header: "Class",
    sortValue: (cert) => equipmentClassLabel(cert.class),
    cell: (cert) => equipmentClassLabel(cert.class),
  },
  {
    id: "expires",
    header: "Expires",
    sortValue: (cert) => cert.expiresOn,
    csv: (cert) => formatExpiresOn(cert.expiresOn),
    cell: (cert) => (
      <span className="flex items-center gap-2">
        <span className="font-mono tabular-nums">{formatExpiresOn(cert.expiresOn)}</span>
        {cert.state === "expired" ? (
          <ToneBadge tone="danger">Expired</ToneBadge>
        ) : cert.state === "expiring" ? (
          <ToneBadge tone="warning">Expiring soon</ToneBadge>
        ) : null}
      </span>
    ),
  },
];

export function TeamPage() {
  const members = useApiQuery<TeamMember[]>("/api/team");
  const certs = useApiQuery<OperatorCertification[]>("/api/certifications");
  const [inviting, setInviting] = useState(false);
  const [certifying, setCertifying] = useState(false);

  const certRows = useMemo<CertRow[]>(
    () =>
      (certs.data ?? []).map((cert) => ({
        ...cert,
        state: isCertExpired(cert.expiresOn) ? "expired" : isCertExpiring(cert.expiresOn) ? "expiring" : "ok",
      })),
    [certs.data],
  );

  const certColumns = useMemo<DataColumn<CertRow>[]>(
    () => [
      ...CERT_COLUMNS,
      {
        id: "actions",
        header: "",
        hideable: false,
        align: "right",
        className: "w-px",
        cell: (cert) => (
          <ActionButton
            variant="ghost"
            className="text-destructive hover:text-destructive"
            action={{
              label: "Remove",
              icon: Trash2,
              onSelect: () => apiMutate(`/api/certifications/${cert.id}`, { method: "DELETE" }),
              success: `Removed the ${equipmentClassLabel(cert.class)} certification${cert.userName ? ` for ${cert.userName}` : ""}.`,
              confirm: {
                title: `Remove ${equipmentClassLabel(cert.class)} certification?`,
                body: `${cert.userName ?? "This teammate"} can no longer check out ${equipmentClassLabel(cert.class).toLowerCase()} equipment on the floor until a new certification is added.`,
                confirmLabel: "Remove certification",
                cancelLabel: "Keep it",
                tone: "danger",
              },
            }}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Team"
        description="Owners see setup. Operators land on the floor and only get the verbs you tick."
      />

      <section className="space-y-2">
        <SectionHeading
          title="Members"
          description="Untick a verb to hide it from that operator's floor launcher. Changes save right away."
          action={
            <Button size="sm" onClick={() => setInviting(true)}>
              <UserPlus className="size-4" />
              Invite teammate
            </Button>
          }
        />
        <DataTable
          id="team"
          paramPrefix="m_"
          data={members.data}
          loading={members.isLoading}
          error={members.error?.message}
          columns={MEMBER_COLUMNS}
          getRowId={(member) => member.id}
          facets={MEMBER_FACETS}
          defaultSort={{ id: "name", desc: false }}
          search={{ placeholder: "Search name or email", text: (member) => `${member.name} ${member.email}` }}
          exportName="team"
          empty={
            <EmptyState
              icon={Users}
              title="No teammates yet."
              body="Invite operators so they can sign in on the floor."
              action={
                <Button size="sm" onClick={() => setInviting(true)}>
                  Invite teammate
                </Button>
              }
            />
          }
        />
      </section>

      <section className="space-y-2">
        <SectionHeading
          title="Equipment certifications"
          description="Operators need a current certification for a class before they can check out that equipment."
          action={
            <Button size="sm" variant="outline" onClick={() => setCertifying(true)} disabled={!members.data?.length}>
              <Plus className="size-4" />
              Add certification
            </Button>
          }
        />
        <DataTable
          id="team-certifications"
          paramPrefix="c_"
          data={certRows}
          loading={certs.isLoading}
          error={certs.error?.message}
          columns={certColumns}
          getRowId={(cert) => cert.id}
          facets={CERT_FACETS}
          defaultSort={{ id: "expires", desc: false }}
          search={{
            placeholder: "Search teammate or class",
            text: (cert) => `${cert.userName ?? ""} ${cert.email ?? ""} ${equipmentClassLabel(cert.class)}`,
          }}
          empty={
            <EmptyState
              icon={BadgeCheck}
              title="No certifications yet."
              body="Add one per teammate and equipment class, with the date it runs out."
              action={
                <Button size="sm" variant="outline" onClick={() => setCertifying(true)} disabled={!members.data?.length}>
                  Add certification
                </Button>
              }
            />
          }
        />
      </section>

      <InviteSheet open={inviting} onOpenChange={setInviting} />
      <CertificationSheet open={certifying} onOpenChange={setCertifying} members={members.data ?? []} />
    </div>
  );
}

function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Ticks save on change. At least one verb has to stay on. */
function FloorVerbsCell({ member }: { member: TeamMember }) {
  const [saving, setSaving] = useState<FloorVerb | null>(null);
  if (member.role === "owner") return <Muted>All verbs</Muted>;
  const current = (member.floorVerbs ?? [...FLOOR_VERBS]) as FloorVerb[];

  async function toggle(verb: FloorVerb, on: boolean) {
    const next = on ? [...new Set([...current, verb])] : current.filter((row) => row !== verb);
    if (next.length === 0) {
      toast.error("Pick at least one floor verb");
      return;
    }
    setSaving(verb);
    try {
      await apiMutate(`/api/team/${member.userId}`, { method: "PATCH", body: JSON.stringify({ floorVerbs: next }) });
      toast.success(`${VERB_LABELS[verb]} ${on ? "on" : "off"} for ${member.name}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update verbs");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {FLOOR_VERBS.map((verb) => (
        <label key={verb} className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={current.includes(verb)}
            disabled={saving !== null}
            onCheckedChange={(value) => void toggle(verb, value === true)}
          />
          {VERB_LABELS[verb]}
        </label>
      ))}
    </div>
  );
}

function InviteSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");
  const write = useWrite();

  useEffect(() => {
    if (open) write.setError(null);
  }, [open]);

  async function submit() {
    const created = await write.run(
      "Invite",
      () =>
        api<TeamMember & { invite?: InviteKind }>("/api/team", {
          method: "POST",
          body: JSON.stringify({
            name,
            email,
            role,
            password: password.trim() || undefined,
          }),
        }),
      (row) => inviteOwnerMessage(row.invite ?? "password", row.name, row.email),
    );
    if (!created) return;
    setName("");
    setEmail("");
    setPassword("");
    onOpenChange(false);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Invite teammate"
      description="Leave the starter password blank to email a set-password link (needs mail)."
      submitLabel="Invite"
      onSubmit={submit}
      busy={write.busy}
      error={write.error}
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="operator">Operator — lands on the floor</option>
          <option value="owner">Owner — sees setup</option>
        </Select>
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
    </FormSheet>
  );
}

function CertificationSheet({
  open,
  onOpenChange,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: TeamMember[];
}) {
  const [userId, setUserId] = useState("");
  const [certClass, setCertClass] = useState<EquipmentClass>("sit_down");
  const [expiresOn, setExpiresOn] = useState("");
  const write = useWrite();
  const chosen = userId || members[0]?.userId || "";

  useEffect(() => {
    if (open) write.setError(null);
  }, [open]);

  async function submit() {
    const person = members.find((member) => member.userId === chosen);
    const created = await write.run(
      "Add certification",
      async () => {
        await api("/api/certifications", {
          method: "POST",
          body: JSON.stringify({ userId: chosen, class: certClass, expiresOn }),
        });
        return true;
      },
      `${person?.name ?? "Teammate"} is certified for ${equipmentClassLabel(certClass).toLowerCase()} until ${expiresOn}.`,
    );
    if (!created) return;
    setExpiresOn("");
    onOpenChange(false);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add certification"
      description="One per teammate and class. Checkout is refused after the expiry date."
      submitLabel="Add certification"
      onSubmit={submit}
      busy={write.busy}
      error={write.error}
    >
      <Field label="Teammate">
        <Select value={chosen} onChange={(e) => setUserId(e.target.value)}>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Class">
        <Select value={certClass} onChange={(e) => setCertClass(e.target.value as EquipmentClass)}>
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
    </FormSheet>
  );
}
