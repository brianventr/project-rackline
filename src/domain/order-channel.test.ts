import { describe, expect, it } from "vitest";
import { orderChannelName } from "./order-channel";

describe("orderChannelName", () => {
  it("names each sales channel", () => {
    expect(orderChannelName("shopify")).toBe("Shopify");
    expect(orderChannelName("etsy")).toBe("Etsy");
    expect(orderChannelName("woocommerce")).toBe("WooCommerce");
    expect(orderChannelName("faire")).toBe("Faire");
  });

  it("names the crowdfunding platform an import came from", () => {
    expect(orderChannelName("crowdfunding:kickstarter")).toBe("Kickstarter");
    expect(orderChannelName("crowdfunding:backerkit")).toBe("BackerKit");
    expect(orderChannelName("crowdfunding:gamefound")).toBe("Gamefound");
    expect(orderChannelName("crowdfunding:generic")).toBe("Crowdfunding");
  });

  it("calls an order entered in Rackline manual, never Floor", () => {
    expect(orderChannelName("manual")).toBe("Manual");
    expect(orderChannelName(null)).toBe("Manual");
    expect(orderChannelName("")).toBe("Manual");
    expect(orderChannelName("something-new")).toBe("Manual");
  });
});
