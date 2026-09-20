import { describe, expect, it } from "vitest";
import {
  destColumns,
  destPatchFromAddress,
  formatShipToAddress,
  parseAddressText,
  resolveFromText,
  resolveOrigin,
  resolvePlace,
} from "./geo";
import { interpolateGreatCircle } from "./geo-arc";

describe("parseAddressText", () => {
  it("reads a US street + city/state/zip block", () => {
    expect(parseAddressText("14 Dock Street\nPortland, OR 97201")).toEqual({
      street: "14 Dock Street",
      city: "Portland",
      region: "OR",
      postal: "97201",
      country: "US",
    });
  });

  it("reads a Canadian city line", () => {
    expect(parseAddressText("12 King Street West\nToronto, ON M5H 1A1")).toMatchObject({
      city: "Toronto",
      region: "ON",
      country: "CA",
    });
  });

  it("treats a trailing UK as country, not a US state", () => {
    expect(parseAddressText("221B Baker Street\nLondon, UK")).toMatchObject({
      city: "London",
      country: "GB",
    });
  });
});

describe("resolvePlace", () => {
  it("geocodes Portland, OR to the city centroid", () => {
    const place = resolveFromText("14 Dock Street\nPortland, OR 97201");
    expect(place).toMatchObject({ city: "Portland", region: "OR", country: "US" });
    expect(place?.lat).toBeCloseTo(45.5152, 3);
    expect(place?.lng).toBeCloseTo(-122.6784, 3);
  });

  it("falls back to the state centroid when the city is unknown", () => {
    const place = resolveFromText("Eugene, OR 97401");
    expect(place).toMatchObject({ city: "Eugene", region: "OR", country: "US" });
    expect(place?.lat).toBeCloseTo(43.8, 1);
  });

  it("maps Shopify structured fields", () => {
    const place = resolvePlace({
      city: "Seattle",
      region: "WA",
      postal: "98101",
      country: "US",
    });
    expect(place).toMatchObject({ city: "Seattle", region: "WA", country: "US" });
    expect(place?.lat).toBeCloseTo(47.6062, 3);
  });

  it("returns dest columns for persistence", () => {
    const patch = destPatchFromAddress("88 Harbor Ave\nSeattle, WA 98101");
    expect(patch.shipToAddress).toContain("Seattle");
    expect(patch.shipToCity).toBe("Seattle");
    expect(patch.shipToRegion).toBe("WA");
    expect(patch.shipToCountry).toBe("US");
    expect(patch.shipToLat).toBeCloseTo(47.6, 1);
  });

  it("resolves a warehouse origin from city/state", () => {
    const origin = resolveOrigin({ city: "Portland", region: "Oregon", country: "USA" });
    expect(origin).toMatchObject({ city: "Portland", region: "OR", country: "US" });
    expect(destColumns(origin).shipToCountry).toBe("US");
  });

  it("formats a Shopify address block", () => {
    expect(
      formatShipToAddress({
        address1: "88 Harbor Ave",
        city: "Seattle",
        region: "WA",
        postal: "98101",
        country: "US",
      }),
    ).toBe("88 Harbor Ave\nSeattle, WA 98101\nUS");
  });
});

describe("great circle", () => {
  it("stays at the origin at t=0 and the destination at t=1", () => {
    const from = { lat: 45.5152, lng: -122.6784 };
    const to = { lat: 40.7128, lng: -74.006 };
    expect(interpolateGreatCircle(from, to, 0)).toEqual(from);
    expect(interpolateGreatCircle(from, to, 1)).toEqual(to);
    const mid = interpolateGreatCircle(from, to, 0.5);
    expect(mid.lng).toBeGreaterThan(from.lng);
    expect(mid.lng).toBeLessThan(to.lng);
  });
});
