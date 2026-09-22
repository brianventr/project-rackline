import { isEmailAddress } from "./purchase-mail";

export class TeamInviteError extends Error {
  constructor(
    message: string,
    public status: 400 | 409 = 400,
    public code?: string,
  ) {
    super(message);
    this.name = "TeamInviteError";
  }
}

export type TeamInviteBody = {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
};

export type ParsedTeamInvite = {
  name: string;
  email: string;
  role: "owner" | "operator";
  password: string | null;
};

export type InviteKind = "emailed" | "password" | "created";

const pendingInvites = new Map<string, { organizationName: string }>();

export function notePendingInvite(email: string, organizationName: string) {
  pendingInvites.set(email.trim().toLowerCase(), { organizationName });
}

export function takePendingInvite(email: string): { organizationName: string } | null {
  const key = email.trim().toLowerCase();
  const row = pendingInvites.get(key) ?? null;
  if (row) pendingInvites.delete(key);
  return row;
}

export function parseTeamInvite(body: TeamInviteBody): ParsedTeamInvite {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password.trim() : "";
  const role = (typeof body.role === "string" ? body.role.trim() : "operator") || "operator";
  if (!name) throw new TeamInviteError("name is required");
  if (!email) throw new TeamInviteError("email is required");
  if (!isEmailAddress(email)) throw new TeamInviteError("email must be an email address");
  if (role !== "owner" && role !== "operator") throw new TeamInviteError("Role must be owner or operator");
  if (password && password.length < 8) throw new TeamInviteError("Password must be at least 8 characters");
  return { name, email, role, password: password || null };
}

export function resolveInvitePassword(
  password: string | null,
  mailConfigured: boolean,
  generate: () => string,
): { password: string; emailed: boolean } {
  if (password) return { password, emailed: false };
  if (!mailConfigured) {
    throw new TeamInviteError(
      "Set MAIL_API_KEY and MAIL_FROM to invite without a starter password",
      409,
      "MAIL_UNAVAILABLE",
    );
  }
  const next = generate();
  if (next.length < 8) throw new TeamInviteError("Generated password was too short");
  return { password: next, emailed: true };
}

export function randomPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function resetMailText(input: { name?: string | null; url: string }): string {
  const who = input.name?.trim() || "there";
  return [
    `Hi ${who},`,
    "",
    "Someone asked to reset the Rackline password for this email.",
    "Open this link to choose a new one (it expires soon):",
    "",
    input.url,
    "",
    "If you did not ask for this, you can ignore the message. Your password stays the same.",
  ].join("\n");
}

export function inviteMailText(input: {
  name: string;
  organizationName: string;
  url: string;
  setPassword: boolean;
}): string {
  const setLine = input.setPassword
    ? "Open this link to set your password and walk onto the floor:"
    : "Your owner set a starter password. Sign in here:";
  return [
    `Hi ${input.name},`,
    "",
    `You were added to ${input.organizationName} on Rackline.`,
    setLine,
    "",
    input.url,
    "",
    "If you were not expecting this, tell your owner.",
  ].join("\n");
}

export function resetMailFor(
  user: { name?: string | null; email: string },
  url: string,
): { subject: string; text: string } {
  const pending = takePendingInvite(user.email);
  if (pending) {
    return {
      subject: `You were added to ${pending.organizationName}`,
      text: inviteMailText({
        name: user.name?.trim() || "there",
        organizationName: pending.organizationName,
        url,
        setPassword: true,
      }),
    };
  }
  return {
    subject: "Reset your Rackline password",
    text: resetMailText({ name: user.name, url }),
  };
}

export function inviteOwnerMessage(invite: InviteKind, name: string, email: string): string {
  if (invite === "emailed") return `Invite sent to ${email}.`;
  if (invite === "created") {
    return `${name} is on the team. Email did not send — they can use Forgot password.`;
  }
  return `${name} can sign in with the starter password.`;
}

export function mailConfigured(env: { MAIL_API_KEY?: string; MAIL_FROM?: string }): boolean {
  return Boolean(env.MAIL_API_KEY?.trim() && env.MAIL_FROM?.trim());
}
