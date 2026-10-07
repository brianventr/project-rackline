import { SHIP_RULE_CHANNEL_LABELS, shipRuleChannel, type ShipRuleChannel } from "./ship-rules";

const CROWDFUNDING_PLATFORMS: Record<string, string> = {
  backerkit: "BackerKit",
  gamefound: "Gamefound",
  kickstarter: "Kickstarter",
};

/** The channel an order came in on, by name: Etsy, Kickstarter, or Manual for one entered in Rackline. */
export function orderChannelName(source: string | null | undefined): string {
  const channel = shipRuleChannel(source);
  if (channel === "crowdfunding") {
    if ((source ?? "").trim().toLowerCase() === "pledge") return SHIP_RULE_CHANNEL_LABELS.crowdfunding;
    const platform = (source ?? "").trim().toLowerCase().slice("crowdfunding:".length);
    return CROWDFUNDING_PLATFORMS[platform] ?? SHIP_RULE_CHANNEL_LABELS.crowdfunding;
  }
  return SHIP_RULE_CHANNEL_LABELS[channel as ShipRuleChannel] ?? SHIP_RULE_CHANNEL_LABELS.manual;
}
