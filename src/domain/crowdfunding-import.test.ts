import { describe, expect, it } from "vitest";
import { parseCrowdfundingCsv, resolveCrowdfundingRows } from "./crowdfunding-import";

const SAMPLE = `Backer Name,Email,SKU,Qty,Address,Tier,Add-ons
Ada Maker,ada@example.com,LAMP,1,"123 Bay St, Portland OR",Early Bird,SHADE|BASE
Jordan Dock,jordan@example.com,LAMP,2,"456 Dock Ave",Standard,
`;

describe("crowdfunding import", () => {
  it("parses BackerKit-style CSV", () => {
    const parsed = parseCrowdfundingCsv(SAMPLE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.rewardSku).toBe("LAMP");
    expect(parsed.rows[0]?.addOnSkus).toEqual(["SHADE", "BASE"]);
    expect(parsed.rows[1]?.qty).toBe(2);
  });

  it("resolves SKUs and reports missing", () => {
    const parsed = parseCrowdfundingCsv(SAMPLE);
    const map = new Map([
      ["LAMP", "item-lamp"],
      ["SHADE", "item-shade"],
    ]);
    const resolved = resolveCrowdfundingRows(parsed.rows, map);
    expect(resolved.missingSkus).toEqual(["BASE"]);
    expect(resolved.orders[0]?.lines.map((l) => l.sku).sort()).toEqual(["LAMP", "SHADE"]);
  });

  it("rejects empty csv", () => {
    const parsed = parseCrowdfundingCsv("name\n");
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});
