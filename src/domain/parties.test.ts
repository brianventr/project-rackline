import { describe, expect, it } from "vitest";
import {
  addressKey,
  customerFill,
  defaultLineCost,
  formatMoney,
  lastCostByItem,
  parseMoneyInput,
  matchCustomer,
  nameKey,
  parseChannelRefs,
  parseCurrency,
  parseLeadTimeDays,
  withChannelRef,
  type CostLine,
  type CustomerCandidate,
} from "./parties";

function customer(over: Partial<CustomerCandidate> & { id: string }): CustomerCandidate {
  return { name: "Rosa Diaz", email: null, shipToAddress: null, channelRefs: [], updatedAt: 1, ...over };
}

describe("name and address keys", () => {
  it("ignores case and surrounding spaces in names", () => {
    expect(nameKey("  Harbor Components ")).toBe(nameKey("harbor components"));
  });

  it("ignores punctuation, case, and line breaks in addresses", () => {
    expect(addressKey("12 Oak St.\nPortland, OR 97201")).toBe(addressKey("12 oak st portland or 97201"));
    expect(addressKey(null)).toBe("");
  });
});

describe("matchCustomer", () => {
  const rosaMail = customer({ id: "mail", email: "rosa@example.com", shipToAddress: "1 Elm St, Austin", updatedAt: 5 });
  const rosaHome = customer({ id: "home", shipToAddress: "12 Oak St, Portland", updatedAt: 3 });
  const rosaBare = customer({ id: "bare", updatedAt: 1 });

  it("matches the channel customer id first", () => {
    const withRef = customer({ id: "ref", name: "R. Diaz", channelRefs: [{ channel: "shopify", ref: "77" }] });
    expect(
      matchCustomer([rosaMail, withRef], { name: "Rosa Diaz", email: "rosa@example.com", channelRef: { channel: "shopify", ref: "77" } }),
    ).toEqual({ id: "ref", via: "channel" });
  });

  it("matches by email regardless of name or address", () => {
    expect(matchCustomer([rosaHome, rosaMail], { name: "Rosa D", email: " ROSA@example.com ", address: "Elsewhere" })).toEqual({
      id: "mail",
      via: "email",
    });
  });

  it("falls back to name plus address when there is no email", () => {
    expect(matchCustomer([rosaMail, rosaHome], { name: "rosa diaz", address: "12 Oak St.\nPortland" })).toEqual({
      id: "home",
      via: "name_address",
    });
  });

  it("creates a new customer when the address differs", () => {
    expect(matchCustomer([rosaHome], { name: "Rosa Diaz", address: "400 Pine Ave, Denver" })).toBeNull();
  });

  it("does not attach a new email to a customer who already has a different one", () => {
    expect(matchCustomer([rosaMail], { name: "Rosa Diaz", email: "other@example.com", address: "1 Elm St, Austin" })).toBeNull();
  });

  it("lets an email order claim a same-name, same-address customer without one", () => {
    expect(matchCustomer([rosaHome], { name: "Rosa Diaz", email: "new@example.com", address: "12 Oak St, Portland" })).toEqual({
      id: "home",
      via: "name_address",
    });
  });

  it("matches by name alone when the order has no address", () => {
    expect(matchCustomer([rosaHome, rosaBare], { name: "Rosa Diaz" })).toEqual({ id: "bare", via: "name" });
    expect(matchCustomer([rosaHome], { name: "Rosa Diaz" })).toEqual({ id: "home", via: "name" });
  });

  it("ignores a malformed email and a blank name", () => {
    expect(matchCustomer([rosaMail], { name: "", email: "not-an-email" })).toBeNull();
  });
});

describe("customerFill", () => {
  it("fills blanks without overwriting", () => {
    const row = customer({ id: "c", shipToAddress: "12 Oak St" });
    expect(
      customerFill(row, { name: "Rosa", email: "rosa@example.com", address: "Other", channelRef: { channel: "woocommerce", ref: "9" } }),
    ).toEqual({ email: "rosa@example.com", channelRefsJson: JSON.stringify([{ channel: "woocommerce", ref: "9" }]) });
    expect(customerFill(customer({ id: "c", email: "a@b.co" }), { name: "Rosa", email: "c@d.co" })).toEqual({});
  });
});

describe("channel refs", () => {
  it("parses stored refs and skips junk", () => {
    expect(parseChannelRefs('[{"channel":"shopify","ref":"1"},{"channel":2},null]')).toEqual([{ channel: "shopify", ref: "1" }]);
    expect(parseChannelRefs("not json")).toEqual([]);
  });

  it("adds a ref once", () => {
    const refs = [{ channel: "shopify", ref: "1" }];
    expect(withChannelRef(refs, { channel: "shopify", ref: "1" })).toBeNull();
    expect(withChannelRef(refs, { channel: "etsy", ref: "1" })).toHaveLength(2);
  });
});

describe("vendor costs", () => {
  const line = (over: Partial<CostLine>): CostLine => ({
    itemId: "bulb",
    sku: "BULB",
    itemName: "Bulb",
    unitCostCents: null,
    qtyOrdered: 10,
    purchaseId: "p",
    purchaseNumber: "PO-1",
    at: 1,
    ...over,
  });

  it("keeps the newest priced line per item", () => {
    const rows = lastCostByItem([
      line({ unitCostCents: 120, at: 1, purchaseNumber: "PO-1" }),
      line({ unitCostCents: 135, at: 3, purchaseNumber: "PO-3" }),
      line({ unitCostCents: null, at: 4, purchaseNumber: "PO-4" }),
      line({ itemId: "cord", sku: "CORD", unitCostCents: null, at: 2 }),
    ]);
    expect(rows.map((row) => [row.sku, row.unitCostCents, row.purchaseNumber])).toEqual([
      ["BULB", 135, "PO-3"],
      ["CORD", null, "PO-1"],
    ]);
  });

  it("defaults a new line from what was typed, then the vendor, then the item", () => {
    expect(defaultLineCost({ typed: 90, vendorLast: 120, itemCost: 100 })).toBe(90);
    expect(defaultLineCost({ vendorLast: 120, itemCost: 100 })).toBe(120);
    expect(defaultLineCost({ itemCost: 100 })).toBe(100);
    expect(defaultLineCost({ itemCost: 0 })).toBeNull();
  });

  it("formats and parses prices", () => {
    expect(formatMoney(175)).toBe("$1.75");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(1250, "EUR")).toBe("€12.50");
    expect(parseMoneyInput("$1.75")).toBe(175);
    expect(parseMoneyInput("2")).toBe(200);
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("1.999")).toBe("invalid");
  });

  it("parses lead time and currency", () => {
    expect(parseLeadTimeDays("14")).toBe(14);
    expect(parseLeadTimeDays("")).toBeNull();
    expect(parseLeadTimeDays(2.5)).toBe("invalid");
    expect(parseCurrency(" eur ")).toBe("EUR");
    expect(parseCurrency("euro")).toBeNull();
  });
});
