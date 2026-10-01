import { describe, expect, it } from "vitest";
import {
  AddressInvalidError,
  addressHash,
  addressProblemMessage,
  addressVerdict,
  checkAddressParts,
  easyPostVerification,
  easyPostVerifyBody,
  isVerifiable,
  materialChange,
  oneLineAddress,
  shipEngineVerification,
  shipEngineVerifyBody,
  shipToParts,
  storedVerification,
} from "./address-check";
import { formatShipAddress, type ShipAddressParts } from "./ship-address";

function problemsOf(text: string, buildingCountry = "US") {
  const parts = shipToParts({ text }, buildingCountry);
  return addressProblemMessage(parts, checkAddressParts(parts));
}

const dock: ShipAddressParts = {
  street1: "14 Dock St",
  street2: "",
  city: "Portland",
  region: "OR",
  postal: "97209",
  country: "US",
};

describe("checkAddressParts", () => {
  it("passes complete addresses at home and abroad", () => {
    for (const text of [
      "2803 Main St\nDallas, TX 75226",
      "14 Dock St, Portland, OR 97209",
      "1 Calle Luna\nSan Juan, PR 00901",
      "PSC 1234 Box 5678\nAPO, AE 09012",
      "12 King Street West\nToronto, ON M5H 1A1\nCanada",
      "Rose Cottage, High Street\nLondon SW1A 2AA\nUK",
      "Hauptstraße 5\n10115 Berlin\nGermany",
      "1 Martin Pl, Sydney NSW 2000, Australia",
      "1 Queen's Road Central\nCentral\nHong Kong",
    ]) {
      expect(problemsOf(text), text).toBeNull();
    }
  });

  it("names every missing part in one sentence, in the country's words", () => {
    expect(problemsOf("14 Dock St, Portland, OR")).toBe("The ship-to address has no ZIP code.");
    expect(problemsOf("14 Dock St\nPortland")).toBe("The ship-to address has no state or ZIP code.");
    expect(problemsOf("14 Dock St")).toBe("The ship-to address has no city, state, or ZIP code.");
    expect(problemsOf("12 King St W\nToronto, ON M5H\nCanada")).toBe("The ship-to address has no province or postal code.");
    expect(problemsOf("10 Downing Street\nLondon SW1A\nUnited Kingdom")).toBe("The ship-to address has no postcode.");
    expect(problemsOf("Hauptstraße 5\nBerlin\nGermany")).toBe("The ship-to address has no postal code.");
    expect(problemsOf("")).toBe("The order has no ship-to address.");
  });

  it("checks US states and ZIP codes, including the state a ZIP belongs to", () => {
    expect(problemsOf("12 Main St\nSpringfield, ZZ 62701")).toBe("ZZ is not a US state.");
    expect(problemsOf("14 Dock St\nPortland, OR 9720")).toBe("9720 is not a US ZIP code.");
    expect(problemsOf("14 Dock St\nPortland, OR 07209")).toBe("ZIP code 07209 is not in Oregon.");
    expect(problemsOf("400 Pine St\nSeattle, OR 98101")).toBe("ZIP code 98101 is not in Oregon.");
    expect(problemsOf("400 Pine St\nSeattle, WA 98101")).toBeNull();
    expect(problemsOf("14 Dock St\nPortland, OR 97209")).toBeNull();
    expect(problemsOf("1 Main St\nEl Paso, TX 88510")).toBeNull();
  });

  it("checks Canadian provinces, postal codes, and the province a postal code belongs to", () => {
    expect(problemsOf("12 King St W\nToronto, BC M5H 1A1\nCanada")).toBe("Postal code M5H 1A1 is not in British Columbia.");
    expect(problemsOf("1 Martin Pl, Sydney XYZ 2000, Australia")).toBe("XYZ is not an Australian state.");
  });

  it("flags an apartment word with no number, and a US street with no house number", () => {
    expect(problemsOf("215 Water St Apt\nBrooklyn, NY 11201")).toBe('The street ends in "Apt" with no number after it.');
    expect(problemsOf("215 Water St\nSuite\nBrooklyn, NY 11201")).toBe('The street ends in "Suite" with no number after it.');
    expect(problemsOf("Water Street\nBrooklyn, NY 11201")).toBe("The street has no house number.");
    expect(problemsOf("215 Water St\nApt 4\nBrooklyn, NY 11201")).toBeNull();
  });

  it("keeps the message to two sentences", () => {
    expect(problemsOf("Water Street\nSpringfield, ZZ")).toBe("The ship-to address has no ZIP code. ZZ is not a US state.");
  });

  it("fills in the building's country when the address names none", () => {
    expect(shipToParts({ text: "Hauptstraße 5\n10115 Berlin" }, "DE").country).toBe("DE");
    expect(shipToParts({ text: "14 Dock St, Portland, OR 97209" }, null).country).toBe("US");
    expect(isVerifiable(shipToParts({ text: "14 Dock St, Portland, OR" }))).toBe(true);
    expect(isVerifiable(shipToParts({ text: "" }))).toBe(false);
  });
});

describe("addressHash", () => {
  it("ignores case, spacing, and punctuation but not a different ZIP", () => {
    const hash = addressHash(dock);
    expect(addressHash({ ...dock, street1: "14  DOCK ST.", city: "portland" })).toBe(hash);
    expect(addressHash({ ...dock, postal: "97210" })).not.toBe(hash);
    expect(hash).toMatch(/^[0-9a-z]+$/);
  });
});

describe("materialChange", () => {
  it("counts a new ZIP, region, house number, or country, not spelling", () => {
    expect(materialChange(dock, { ...dock, street1: "14 DOCK ST", city: "PORTLAND", postal: "97209-1234" })).toBe(false);
    expect(materialChange(dock, { ...dock, city: "PDX" })).toBe(false);
    expect(materialChange(dock, { ...dock, postal: "97210-1234" })).toBe(true);
    expect(materialChange({ ...dock, postal: "" }, dock)).toBe(true);
    expect(materialChange(dock, { ...dock, street1: "41 Dock St" })).toBe(true);
    expect(materialChange(dock, { ...dock, region: "WA" })).toBe(true);
    expect(materialChange(dock, { ...dock, country: "CA" })).toBe(true);
    const berlin = { street1: "Hauptstraße 5", street2: "", city: "Berlin", region: "", postal: "10115", country: "DE" };
    expect(materialChange(berlin, { ...berlin, street1: "HAUPTSTRASSE 5", region: "BE" })).toBe(false);
  });

  it("counts a postal code the carrier filled in anywhere it is used", () => {
    const london = { street1: "10 Downing Street", street2: "", city: "London", region: "", postal: "", country: "GB" };
    expect(materialChange(london, { ...london, postal: "SW1A 2AA" })).toBe(true);
    expect(materialChange({ ...london, postal: "SW1A 2AA" }, { ...london, postal: "SW1A 2AA", region: "ENGLAND" })).toBe(false);
    const central = { street1: "1 Queen's Road Central", street2: "", city: "Central", region: "", postal: "", country: "HK" };
    expect(materialChange(central, { ...central, postal: "000000" })).toBe(false);
  });
});

describe("carrier verification", () => {
  it("builds the EasyPost and ShipEngine requests", () => {
    expect(easyPostVerifyBody({ ...dock, street2: "Apt 4" }, "Ana Ruiz")).toEqual({
      address: { name: "Ana Ruiz", street1: "14 Dock St", street2: "Apt 4", city: "Portland", state: "OR", zip: "97209", country: "US" },
      verify: true,
    });
    expect(shipEngineVerifyBody(dock, "Ana Ruiz")).toEqual([
      {
        name: "Ana Ruiz",
        address_line1: "14 Dock St",
        city_locality: "Portland",
        state_province: "OR",
        postal_code: "97209",
        country_code: "US",
      },
    ]);
  });

  it("reads EasyPost: standardized is valid, a new ZIP is a correction, and some errors mean not checked", () => {
    const address = (fields: Record<string, unknown>, delivery: Record<string, unknown>) => ({
      street1: "14 DOCK ST",
      street2: null,
      city: "PORTLAND",
      state: "OR",
      zip: "97209-1234",
      country: "US",
      ...fields,
      verifications: { delivery },
    });
    expect(easyPostVerification(address({}, { success: true, errors: [] }), dock).status).toBe("valid");
    const corrected = easyPostVerification(address({}, { success: true, errors: [] }), { ...dock, postal: "" });
    expect(corrected).toMatchObject({ provider: "easypost", status: "corrected" });
    expect(corrected.suggestion).toEqual({ street1: "14 DOCK ST", street2: "", city: "PORTLAND", region: "OR", postal: "97209-1234", country: "US" });
    expect(
      easyPostVerification(address({}, { success: false, errors: [{ code: "E.ADDRESS.NOT_FOUND", field: "address", message: "Address not found" }] }), dock),
    ).toMatchObject({ status: "invalid", message: "Address not found", suggestion: null });
    expect(
      easyPostVerification(
        address({}, { success: true, errors: [{ code: "E.SECONDARY_INFORMATION.MISSING", message: "Missing secondary information(Apt/Suite#)" }] }),
        dock,
      ),
    ).toMatchObject({ status: "invalid", message: "Missing secondary information(Apt/Suite#)" });
    expect(easyPostVerification(address({}, { success: false, errors: [{ code: "E.COUNTRY.UNSUPPORTED" }] }), dock).status).toBe("unverified");
    expect(easyPostVerification({ error: { code: "x" } }, dock).status).toBe("unverified");
  });

  it("reads ShipEngine statuses and its matched address", () => {
    const matched = { address_line1: "14 DOCK ST", city_locality: "PORTLAND", state_province: "OR", postal_code: "97209-1234", country_code: "US" };
    expect(shipEngineVerification([{ status: "verified", matched_address: matched, messages: [] }], dock).status).toBe("valid");
    expect(
      shipEngineVerification([{ status: "warning", matched_address: { ...matched, postal_code: "97210" }, messages: [] }], dock),
    ).toMatchObject({ provider: "shipengine", status: "corrected", suggestion: { postal: "97210", city: "PORTLAND" } });
    expect(
      shipEngineVerification(
        [{ status: "error", matched_address: null, messages: [{ type: "error", code: "a1004", message: "Address not found." }] }],
        dock,
      ),
    ).toMatchObject({ status: "invalid", message: "Address not found." });
    expect(shipEngineVerification([{ status: "unverified", messages: [] }], dock).status).toBe("unverified");
  });

  it("round-trips through the address_checks cache", () => {
    const suggestion = { ...dock, postal: "97209-1234" };
    const row = { provider: "easypost", status: "corrected", message: null, suggestionJson: JSON.stringify(suggestion) };
    expect(storedVerification(row)).toEqual({ provider: "easypost", status: "corrected", message: null, suggestion });
    expect(storedVerification({ ...row, suggestionJson: "{not json" })?.suggestion).toBeNull();
    expect(storedVerification({ provider: null, status: "unchecked", message: null, suggestionJson: null })).toBeNull();
  });
});

describe("addressVerdict", () => {
  const easyPost = (status: "valid" | "corrected" | "invalid" | "unverified", extra: Partial<{ message: string; suggestion: ShipAddressParts }> = {}) => ({
    provider: "easypost" as const,
    status,
    message: extra.message ?? null,
    suggestion: extra.suggestion ?? null,
  });
  const fixed = { street1: "14 DOCK ST", street2: "", city: "PORTLAND", region: "OR", postal: "97209-1234", country: "US" };

  it("ships a complete address the carrier verified or could not check", () => {
    expect(addressVerdict({ parts: dock }).blocked).toBe(false);
    expect(addressVerdict({ parts: dock, verification: easyPost("valid") }).blocked).toBe(false);
    expect(addressVerdict({ parts: dock, verification: easyPost("unverified") }).blocked).toBe(false);
  });

  it("holds an incomplete address and offers the carrier's completed one", () => {
    const verdict = addressVerdict({ parts: { ...dock, postal: "" }, verification: easyPost("corrected", { suggestion: fixed }) });
    expect(verdict).toMatchObject({ blocked: true, message: "The ship-to address has no ZIP code.", suggestion: fixed });
  });

  it("says what the carrier found", () => {
    expect(addressVerdict({ parts: dock, verification: easyPost("invalid", { message: "Address not found" }) }).message).toBe(
      "EasyPost could not verify this address: Address not found.",
    );
    const moved = { ...fixed, postal: "97210-4321" };
    expect(addressVerdict({ parts: dock, verification: easyPost("corrected", { suggestion: moved }) })).toMatchObject({
      blocked: true,
      message: "EasyPost knows this address as 14 DOCK ST, PORTLAND, OR 97210-4321, US.",
      suggestion: moved,
    });
  });

  it("trusts a carrier that delivers to the address as entered over the local hints, not over a missing part", () => {
    const general = { ...dock, street1: "General Delivery" };
    expect(addressVerdict({ parts: general }).message).toBe("The street has no house number.");
    expect(addressVerdict({ parts: general, verification: easyPost("valid") }).blocked).toBe(false);
    expect(addressVerdict({ parts: { ...dock, postal: "" }, verification: easyPost("valid") }).message).toBe(
      "The ship-to address has no ZIP code.",
    );
  });

  it("answers a held address with its message and the suggestion on one line", () => {
    const error = new AddressInvalidError(addressVerdict({ parts: { ...dock, postal: "" }, verification: easyPost("corrected", { suggestion: fixed }) }));
    expect(error).toMatchObject({ code: "ADDRESS_INVALID", message: "The ship-to address has no ZIP code.", suggestion: "14 DOCK ST, PORTLAND, OR 97209-1234, US" });
    expect(new AddressInvalidError(addressVerdict({ parts: { ...dock, street1: "" } })).suggestion).toBeNull();
  });

  it("lets an override ship this exact address", () => {
    const overridden = addressVerdict({ parts: { ...dock, postal: "" }, overridden: true });
    expect(overridden).toMatchObject({ blocked: false, overridden: true, message: null, suggestion: null });
    expect(addressVerdict({ parts: dock }).overridden).toBe(false);
    expect(overridden.hash).toBe(addressHash({ ...dock, postal: "" }));
  });

  it("writes a suggestion back as text that reads as the same address", () => {
    for (const suggestion of [fixed, { street1: "12 KING ST W", street2: "", city: "TORONTO", region: "ON", postal: "M5H 1A1", country: "CA" }]) {
      const reread = shipToParts({ text: formatShipAddress(suggestion) }, "US");
      expect(reread).toEqual(suggestion);
      expect(oneLineAddress(reread)).toBe(oneLineAddress(suggestion));
    }
  });
});
