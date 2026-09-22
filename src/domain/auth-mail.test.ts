import { describe, expect, it } from "vitest";
import {
  inviteMailText,
  mailConfigured,
  parseTeamInvite,
  resetMailText,
  resolveInvitePassword,
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
});
