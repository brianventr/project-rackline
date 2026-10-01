import { describe, expect, it } from "vitest";
import {
  countryCode,
  crossesBorder,
  formatPostal,
  formatShipAddress,
  postalRequired,
  regionRequired,
  shipAddressParts,
} from "./ship-address";

describe("shipAddressParts", () => {
  it("reads one-line US addresses with the street in front", () => {
    expect(shipAddressParts({ text: "14 Dock St, Portland, OR 97209" })).toEqual({
      street1: "14 Dock St",
      street2: "",
      city: "Portland",
      region: "OR",
      postal: "97209",
      country: "US",
    });
    expect(shipAddressParts({ text: "12 Test St, Suite 4, Portland, Oregon 97205, US" })).toMatchObject({
      street1: "12 Test St",
      street2: "Suite 4",
      city: "Portland",
      region: "OR",
      country: "US",
    });
  });

  it("reads multi-line addresses and keeps extra street lines", () => {
    expect(shipAddressParts({ text: "215 Water St\nApt 3\nBrooklyn, NY 11201\nUS" })).toEqual({
      street1: "215 Water St",
      street2: "Apt 3",
      city: "Brooklyn",
      region: "NY",
      postal: "11201",
      country: "US",
    });
    expect(shipAddressParts({ text: "18 Valencia St\nSan Francisco CA 94110" })).toMatchObject({
      city: "San Francisco",
      region: "CA",
      country: "US",
    });
  });

  it("reads Canadian, UK, and Australian forms", () => {
    expect(shipAddressParts({ text: "12 King Street West\nToronto, ON m5h1a1" })).toMatchObject({
      city: "Toronto",
      region: "ON",
      postal: "M5H 1A1",
      country: "CA",
    });
    expect(shipAddressParts({ text: "10 Downing Street\nLondon sw1a2aa\nUnited Kingdom" })).toEqual({
      street1: "10 Downing Street",
      street2: "",
      city: "London",
      region: "",
      postal: "SW1A 2AA",
      country: "GB",
    });
    expect(shipAddressParts({ text: "1 Martin Pl, Sydney NSW 2000, Australia" })).toMatchObject({
      street1: "1 Martin Pl",
      city: "Sydney",
      region: "NSW",
      postal: "2000",
      country: "AU",
    });
  });

  it("reads postal-first and city-first forms elsewhere", () => {
    expect(shipAddressParts({ text: "Hauptstraße 5\n10115 Berlin\nGermany" })).toMatchObject({
      street1: "Hauptstraße 5",
      city: "Berlin",
      postal: "10115",
      country: "DE",
    });
    expect(shipAddressParts({ text: "Damrak 1\n1012 LG Amsterdam\nNL" })).toMatchObject({ city: "Amsterdam", postal: "1012 LG" });
    expect(shipAddressParts({ text: "1-1 Chiyoda\nChiyoda-ku, Tokyo 100-0001\nJP" })).toMatchObject({
      street1: "1-1 Chiyoda",
      street2: "Chiyoda-ku",
      city: "Tokyo",
      postal: "100-0001",
      country: "JP",
    });
  });

  it("reads a bare CA or OR after a city as the state, and a code after a postal code as the country", () => {
    expect(shipAddressParts({ text: "18 Valencia St, San Francisco, CA" })).toMatchObject({ region: "CA", country: "US" });
    expect(shipAddressParts({ text: "12 King St W, Toronto, ON M5H 1A1, CA" })).toMatchObject({ country: "CA" });
  });

  it("falls back to the stored city, region, and country for what the text leaves out", () => {
    expect(shipAddressParts({ text: "221B Baker Street\nLondon, UK" })).toMatchObject({
      street1: "221B Baker Street",
      city: "London",
      postal: "",
      country: "GB",
    });
    expect(shipAddressParts({ text: "Shop A", city: "Austin", region: "TX", country: "US" })).toMatchObject({
      street1: "Shop A",
      city: "Austin",
      region: "TX",
      country: "US",
    });
  });

  it("prints parts back one per line", () => {
    expect(formatShipAddress(shipAddressParts({ text: "10 Downing Street, London SW1A 2AA, GB" }))).toBe(
      "10 Downing Street\nLondon, SW1A 2AA\nGB",
    );
  });
});

describe("country rules", () => {
  it("normalizes country names and codes", () => {
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("usa")).toBe("US");
    expect(countryCode("cn")).toBe("CN");
    expect(countryCode("Narnia")).toBeNull();
  });

  it("knows which countries need a region or a postal code", () => {
    expect(regionRequired("US")).toBe(true);
    expect(regionRequired("GB")).toBe(false);
    expect(postalRequired("GB")).toBe(true);
    expect(postalRequired("HK")).toBe(false);
  });

  it("only counts known, different countries as crossing a border", () => {
    expect(crossesBorder("US", "CA")).toBe(true);
    expect(crossesBorder("US", "US")).toBe(false);
    expect(crossesBorder("US", null)).toBe(false);
  });

  it("formats postal codes the way carriers print them", () => {
    expect(formatPostal("GB", "ec1a1bb")).toBe("EC1A 1BB");
    expect(formatPostal("CA", "k1a 0b1")).toBe("K1A 0B1");
    expect(formatPostal("US", "97209")).toBe("97209");
  });
});
