import { describe, expect, it } from "vitest";
import { copyIfEmptyImageUrl, mediaItemKey, mediaKeyOwnedByOrg, normalizeImageUrl } from "./media";

describe("normalizeImageUrl", () => {
  it("treats empty as null", () => {
    expect(normalizeImageUrl(null)).toBeNull();
    expect(normalizeImageUrl("")).toBeNull();
    expect(normalizeImageUrl("   ")).toBeNull();
  });

  it("accepts https, demo assets, and managed media paths", () => {
    expect(normalizeImageUrl("https://cdn.shopify.com/lamp.jpg")).toBe("https://cdn.shopify.com/lamp.jpg");
    expect(normalizeImageUrl("http://example.com/a.png")).toBe("http://example.com/a.png");
    expect(normalizeImageUrl("/demo-sku/LAMP.svg")).toBe("/demo-sku/LAMP.svg");
    expect(normalizeImageUrl("/api/media/org/abc/items/item-1")).toBe("/api/media/org/abc/items/item-1");
    expect(normalizeImageUrl("/api/media/org/abc/boms/bom-1/steps/step-1")).toBe(
      "/api/media/org/abc/boms/bom-1/steps/step-1",
    );
  });

  it("rejects unsafe schemes and relative paths", () => {
    expect(() => normalizeImageUrl("javascript:alert(1)")).toThrow("Invalid image URL");
    expect(() => normalizeImageUrl("data:image/png;base64,aaa")).toThrow("Invalid image URL");
    expect(() => normalizeImageUrl("/etc/passwd")).toThrow("Invalid image URL");
    expect(() => normalizeImageUrl("/demo-sku/../lamp.svg")).toThrow("Invalid image URL");
    expect(() => normalizeImageUrl("/api/media/../secret")).toThrow("Invalid image URL");
  });
});

describe("copyIfEmptyImageUrl", () => {
  it("fills an empty SKU photo and never overwrites one", () => {
    expect(copyIfEmptyImageUrl(null, "https://cdn.shopify.com/lamp.jpg")).toBe("https://cdn.shopify.com/lamp.jpg");
    expect(copyIfEmptyImageUrl("/demo-sku/LAMP.svg", "https://cdn.shopify.com/lamp.jpg")).toBe("/demo-sku/LAMP.svg");
    expect(copyIfEmptyImageUrl(null, "javascript:alert(1)")).toBeNull();
  });
});

describe("media keys", () => {
  it("scopes object keys to the organization", () => {
    const key = mediaItemKey("org-1", "item-1");
    expect(key).toBe("org/org-1/items/item-1");
    expect(mediaKeyOwnedByOrg(key, "org-1")).toBe(true);
    expect(mediaKeyOwnedByOrg(key, "org-2")).toBe(false);
  });
});
