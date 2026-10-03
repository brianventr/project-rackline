import { describe, expect, it } from "vitest";
import { LAB_CLOSED_MESSAGE, decideLabAccess, parseLabOrgIds } from "./lab-access";

describe("lab access", () => {
  it("reads the allow-list loosely and treats blank as everyone", () => {
    expect(parseLabOrgIds(undefined)).toBeNull();
    expect(parseLabOrgIds("  ")).toBeNull();
    expect([...parseLabOrgIds("org_a, org_b\norg_c")!]).toEqual(["org_a", "org_b", "org_c"]);
  });

  it("never opens the lab to the shared demo organization", () => {
    expect(decideLabAccess({ organizationId: "demo", demoOrganization: true, allowedOrgIds: null })).toBe("demo");
    // Not even when someone lists it.
    expect(decideLabAccess({ organizationId: "demo", demoOrganization: true, allowedOrgIds: new Set(["demo"]) })).toBe("demo");
  });

  it("opens to every other organization unless an allow-list says otherwise", () => {
    expect(decideLabAccess({ organizationId: "org_a", demoOrganization: false, allowedOrgIds: null })).toBe("open");
    expect(decideLabAccess({ organizationId: "org_a", demoOrganization: false, allowedOrgIds: new Set(["org_a"]) })).toBe("open");
    expect(decideLabAccess({ organizationId: "org_b", demoOrganization: false, allowedOrgIds: new Set(["org_a"]) })).toBe("not-listed");
  });

  it("explains each closed case", () => {
    expect(LAB_CLOSED_MESSAGE.demo).toMatch(/demo/);
    expect(LAB_CLOSED_MESSAGE["not-listed"]).toMatch(/not open/);
  });
});
