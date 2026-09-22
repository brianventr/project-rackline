import { describe, expect, it } from "vitest";
import {
  inviteMailText,
  inviteOwnerMessage,
  mailConfigured,
  notePendingInvite,
  parseTeamInvite,
  resetMailFor,
  resetMailText,
  resolveInvitePassword,
  takePendingInvite,
  TeamInviteError,
} from "./auth-mail";

describe("team invite", () => {
  it("parses owner invites and rejects a bad email", () => {
    expect(parseTeamInvite({ name: "Maya", email: "Maya@Shop.Example", role: "operator" })).toEqual({
      name: "Maya",
      email: "maya@shop.example",
      role: "operator",
      password: null,
    });
    expect(() => parseTeamInvite({ name: "Maya", email: "Maya Chen" })).toThrow(/email must be an email/);
    expect(() => parseTeamInvite({ name: "Maya", email: "maya@shop.example", password: "short" })).toThrow(
      /at least 8/,
    );
  });

  it("emails a generated password when mail is on, else 409", () => {
    expect(resolveInvitePassword("rackline-demo", false, () => "generated-password")).toEqual({
      password: "rackline-demo",
      emailed: false,
    });
    expect(resolveInvitePassword(null, true, () => "generated-password")).toEqual({
      password: "generated-password",
      emailed: true,
    });
    try {
      resolveInvitePassword(null, false, () => "generated-password");
      throw new Error("expected 409");
    } catch (err) {
      expect(err).toBeInstanceOf(TeamInviteError);
      expect(err).toMatchObject({ status: 409, code: "MAIL_UNAVAILABLE" });
    }
  });

  it("writes reset and invite copy without putting the password in the body", () => {
    const reset = resetMailText({ name: "Maya", url: "https://app.example/reset-password?token=abc" });
    expect(reset).toContain("Hi Maya");
    expect(reset).toContain("https://app.example/reset-password?token=abc");
    const invite = inviteMailText({
      name: "Jordan",
      organizationName: "Northwind Makers",
      url: "https://app.example/reset-password?token=xyz",
      setPassword: true,
    });
    expect(invite).toContain("Northwind Makers");
    expect(invite).toContain("set your password");
    expect(invite).not.toMatch(/rackline-demo|generated-password/);
    expect(mailConfigured({ MAIL_API_KEY: "re_1", MAIL_FROM: "floor@rackline.example" })).toBe(true);
    expect(mailConfigured({ MAIL_API_KEY: "", MAIL_FROM: "floor@rackline.example" })).toBe(false);
  });

  it("uses invite copy once for a pending teammate, then reset copy", () => {
    notePendingInvite("Jordan@Shop.Example", "Northwind Makers");
    const first = resetMailFor(
      { name: "Jordan", email: "jordan@shop.example" },
      "https://app.example/api/auth/reset-password/tok",
    );
    expect(first.subject).toBe("You were added to Northwind Makers");
    expect(first.text).toContain("You were added to Northwind Makers");
    expect(first.text).toContain("set your password");
    expect(takePendingInvite("jordan@shop.example")).toBeNull();

    const second = resetMailFor(
      { name: "Jordan", email: "jordan@shop.example" },
      "https://app.example/api/auth/reset-password/tok2",
    );
    expect(second.subject).toBe("Reset your Rackline password");
    expect(second.text).toContain("reset the Rackline password");
  });

  it("tells the owner whether mail went out without implying a starter password was emailed", () => {
    expect(inviteOwnerMessage("emailed", "Maya", "maya@shop.example")).toBe("Invite sent to maya@shop.example.");
    expect(inviteOwnerMessage("password", "Maya", "maya@shop.example")).toBe(
      "Maya can sign in with the starter password.",
    );
    expect(inviteOwnerMessage("created", "Maya", "maya@shop.example")).toMatch(/Forgot password/);
  });
});
