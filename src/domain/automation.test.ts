import { describe, expect, it } from "vitest";
import {
  automationPolicyFromStored,
  parseAutomationPolicy,
  replenishmentReminderDue,
  uncoveredSuggestions,
  type AutomationPolicy,
} from "./automation";

const published: AutomationPolicy = {
  replenishMode: "auto_queue",
  bulkGap: "exception",
  remindOpenAfterHours: 8,
  reorderAlert: "exception",
};

describe("automation policy", () => {
  it("keeps the old behavior when nothing is stored", () => {
    expect(automationPolicyFromStored(null)).toEqual({
      replenishMode: "suggest",
      bulkGap: "silent",
      remindOpenAfterHours: null,
      reorderAlert: "today",
    });
    expect(automationPolicyFromStored("{")).toEqual(automationPolicyFromStored(null));
  });

  it("reads a stored policy and ignores unknown fields", () => {
    expect(automationPolicyFromStored(JSON.stringify({ ...published, extra: true }))).toEqual(published);
  });

  it("rejects a publish that leaves a field off", () => {
    expect(() => parseAutomationPolicy({ replenishMode: "suggest" })).toThrow(/bulk/i);
    expect(() => parseAutomationPolicy({ ...published, remindOpenAfterHours: 0 })).toThrow(/hours/i);
    expect(parseAutomationPolicy({ ...published, remindOpenAfterHours: null }).remindOpenAfterHours).toBeNull();
  });
});

describe("auto-queue coverage", () => {
  const suggestion = { itemId: "bulb", toLocationId: "pick", qty: 4 };

  it("skips a pick face that already has an open replenishment", () => {
    const first = uncoveredSuggestions([suggestion], []);
    expect(first).toEqual([suggestion]);
    expect(uncoveredSuggestions([suggestion], [{ itemId: "bulb", toLocationId: "pick" }])).toEqual([]);
    expect(uncoveredSuggestions(first, first)).toEqual([]);
  });

  it("reminds only after the chosen hours", () => {
    const createdAt = 1_000;
    expect(replenishmentReminderDue(createdAt, createdAt + 8 * 3_600_000 - 1, 8)).toBe(false);
    expect(replenishmentReminderDue(createdAt, createdAt + 8 * 3_600_000, 8)).toBe(true);
    expect(replenishmentReminderDue(createdAt, createdAt + 86_400_000, null)).toBe(false);
  });
});
