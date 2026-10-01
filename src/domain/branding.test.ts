import { describe, expect, it } from "vitest";
import { BrandingError, brandInk, parseBrandColor, parseLogoUrl } from "./branding";

describe("brand colour", () => {
  it("normalizes short and long hex to lowercase #rrggbb", () => {
    expect(parseBrandColor("#1F6FEB")).toBe("#1f6feb");
    expect(parseBrandColor("1f6feb")).toBe("#1f6feb");
    expect(parseBrandColor("#0af")).toBe("#00aaff");
    expect(parseBrandColor("  ")).toBeNull();
    expect(parseBrandColor(null)).toBeNull();
  });

  it("refuses anything but a hex colour", () => {
    expect(() => parseBrandColor("blue")).toThrow(BrandingError);
    expect(() => parseBrandColor("#12345")).toThrow(BrandingError);
    expect(() => parseBrandColor("red; background:url(x)")).toThrow(BrandingError);
    expect(() => parseBrandColor(12)).toThrow(BrandingError);
  });

  it("picks readable text on the colour", () => {
    expect(brandInk("#000000")).toBe("#ffffff");
    expect(brandInk("#1f2937")).toBe("#ffffff");
    expect(brandInk("#ffffff")).toBe("#111827");
    expect(brandInk("#facc15")).toBe("#111827");
  });
});

describe("logo URL", () => {
  it("keeps https links", () => {
    expect(parseLogoUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(parseLogoUrl("")).toBeNull();
  });

  it("refuses links a customer's browser cannot load safely", () => {
    expect(() => parseLogoUrl("http://cdn.example.com/logo.png")).toThrow(/https/);
    expect(() => parseLogoUrl("javascript:alert(1)")).toThrow(BrandingError);
    expect(() => parseLogoUrl("/api/media/org/x/items/y")).toThrow(BrandingError);
    expect(() => parseLogoUrl("https://user:pw@cdn.example.com/logo.png")).toThrow(BrandingError);
    expect(() => parseLogoUrl(`https://cdn.example.com/${"a".repeat(2100)}`)).toThrow(/too long/);
  });
});
