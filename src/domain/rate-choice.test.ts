import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  arrivalYmd,
  chooseRate,
  expiringCache,
  mapWithLimit,
  promiseYmd,
  rateCandidates,
  rateQuoteKey,
  shortDay,
  withTimeout,
  type RateOption,
  type RateTiming,
} from "./rate-choice";

const LA = "America/Los_Angeles";
/** Wednesday 30 Sep 2026, 10:00 in Los Angeles. */
const WED_10AM = Date.UTC(2026, 8, 30, 17, 0);

const timing: RateTiming = { now: WED_10AM, timeZone: LA, cutoffs: {} };

const ups: RateOption = { id: "ups_ground", company: "UPS", service: "Ground", connectionId: "c-ups", provider: "ups", amountCents: 900, transitDays: 5 };
const usps: RateOption = { id: "usps_priority", company: "USPS", service: "Priority", connectionId: "c-usps", provider: "usps", amountCents: 1200, transitDays: 3 };
const demo: RateOption = { id: "rackline_ground", company: "Rackline", service: "Ground", connectionId: "c-rl", provider: "rackline", amountCents: 500, transitDays: 5 };

describe("addBusinessDays", () => {
  it("skips Saturday and Sunday", () => {
    expect(addBusinessDays(20260930, 0)).toBe(20260930);
    expect(addBusinessDays(20260930, 1)).toBe(20261001);
    expect(addBusinessDays(20260930, 2)).toBe(20261002);
    expect(addBusinessDays(20260930, 3)).toBe(20261005);
    expect(addBusinessDays(20261002, 1)).toBe(20261005);
  });

  it("starts a weekend day on Monday", () => {
    expect(addBusinessDays(20261003, 0)).toBe(20261005);
    expect(addBusinessDays(20261004, 1)).toBe(20261006);
  });

  it("crosses months and years", () => {
    expect(addBusinessDays(20261231, 2)).toBe(20270104);
    expect(addBusinessDays(20260227, 1)).toBe(20260302);
  });
});

describe("promise and arrival days", () => {
  it("promises delivery days after the local order day", () => {
    expect(promiseYmd(WED_10AM, LA, 4)).toBe(20261006);
    // 20:00 Tuesday in Los Angeles is already Wednesday in UTC; the building's day counts.
    expect(promiseYmd(Date.UTC(2026, 8, 30, 3, 0), LA, 1)).toBe(20260930);
  });

  it("has no promise without delivery days", () => {
    expect(promiseYmd(WED_10AM, LA, null)).toBeNull();
    expect(promiseYmd(WED_10AM, LA, 0)).toBeNull();
  });

  it("counts transit from the next pickup", () => {
    expect(arrivalYmd(usps, timing)).toBe(20261005);
    expect(arrivalYmd(ups, timing)).toBe(20261007);
  });

  it("waits for tomorrow's pickup once the carrier's cutoff has passed", () => {
    expect(arrivalYmd(ups, { ...timing, cutoffs: { UPS: 9 * 60 } })).toBe(20261008);
    expect(arrivalYmd(ups, { ...timing, cutoffs: { "*": 9 * 60, UPS: 17 * 60 } })).toBe(20261007);
  });

  it("formats a short day", () => {
    expect(shortDay(20261002)).toBe("Fri, Oct 2");
  });
});

describe("chooseRate", () => {
  const quotes = [ups, usps, demo];
  const base = { timing, promise: null, accountConnected: true };

  it("cheapest picks the lowest price and leaves the demo carrier out", () => {
    const pick = chooseRate(quotes, "cheapest", base);
    expect(pick?.quote.id).toBe("ups_ground");
    expect(pick?.reason).toBe("Cheapest");
    expect(pick?.late).toBe(false);
  });

  it("fastest picks the earliest arrival", () => {
    const pick = chooseRate(quotes, "fastest", base);
    expect(pick?.quote.id).toBe("usps_priority");
    expect(pick?.arrival).toBe(20261005);
  });

  it("on time picks the cheapest that arrives by the promise", () => {
    expect(chooseRate(quotes, "on_time", { ...base, promise: 20261006 })).toMatchObject({
      quote: { id: "usps_priority" },
      late: false,
      reason: "Cheapest on time",
    });
    expect(chooseRate(quotes, "on_time", { ...base, promise: 20261009 })?.quote.id).toBe("ups_ground");
  });

  it("on time falls back to the fastest, marked late, when nothing arrives in time", () => {
    const pick = chooseRate(quotes, "on_time", { ...base, promise: 20261001 });
    expect(pick?.quote.id).toBe("usps_priority");
    expect(pick?.late).toBe(true);
    expect(pick?.reason).toBe("Fastest (nothing arrives by Thu, Oct 1)");
  });

  it("on time without a promise picks the cheapest", () => {
    const pick = chooseRate(quotes, "on_time", base);
    expect(pick?.quote.id).toBe("ups_ground");
    expect(pick?.reason).toBe("Cheapest (no delivery promise set)");
  });

  it("marks a cheapest pick late when it misses the promise", () => {
    expect(chooseRate(quotes, "cheapest", { ...base, promise: 20261006 })?.late).toBe(true);
  });

  it("breaks ties on the other measure", () => {
    const slowTwin = { ...usps, id: "usps_ground", service: "Ground Advantage", transitDays: 5 };
    expect(chooseRate([slowTwin, usps], "cheapest", base)?.quote.id).toBe("usps_priority");
    const pricier = { ...usps, id: "usps_express", service: "Express", amountCents: 3000 };
    expect(chooseRate([pricier, usps], "fastest", base)?.quote.id).toBe("usps_priority");
  });

  it("uses each carrier's cutoff to rank speed", () => {
    const upsTwoDay = { ...ups, id: "ups_2day", service: "2nd Day Air", amountCents: 2000, transitDays: 2 };
    const uspsTwoDay = { ...usps, id: "usps_2day", amountCents: 2500, transitDays: 2 };
    const late = { ...timing, cutoffs: { UPS: 9 * 60 } };
    expect(chooseRate([upsTwoDay, uspsTwoDay], "fastest", { ...base, timing: late })?.quote.id).toBe("usps_2day");
    expect(chooseRate([upsTwoDay, uspsTwoDay], "fastest", base)?.quote.id).toBe("ups_2day");
  });

  it("uses the demo carrier only when no carrier account is connected", () => {
    expect(rateCandidates([ups, demo], true)).toEqual([ups]);
    expect(rateCandidates([demo], false)).toEqual([demo]);
    expect(chooseRate([demo], "fastest", { ...base, accountConnected: false })?.quote.id).toBe("rackline_ground");
  });

  it("does not fall back to the demo carrier when the connected accounts fail to quote", () => {
    expect(chooseRate([demo], "cheapest", base)).toBeNull();
  });

  it("has nothing to pick without quotes", () => {
    expect(chooseRate([], "cheapest", base)).toBeNull();
  });
});

describe("rateQuoteKey", () => {
  const base = {
    organizationId: "org",
    orderId: "o1",
    connectionId: "c1",
    parcel: { weightOz: 12, lengthIn: 10, widthIn: 8, heightIn: 2 },
    shipFrom: "14 Dock St, Portland, OR 97209",
    shipTo: "1 Main St, Austin, TX 78701",
    serviceIds: ["ups_ground", "ups_2day"],
  };

  it("ignores the order services are listed in", () => {
    expect(rateQuoteKey(base)).toBe(rateQuoteKey({ ...base, serviceIds: ["ups_2day", "ups_ground", "ups_2day"] }));
  });

  it("changes with the parcel, the addresses, the account, and the order", () => {
    const key = rateQuoteKey(base);
    expect(rateQuoteKey({ ...base, parcel: { ...base.parcel, weightOz: 13 } })).not.toBe(key);
    expect(rateQuoteKey({ ...base, shipTo: "2 Main St, Austin, TX 78701" })).not.toBe(key);
    expect(rateQuoteKey({ ...base, connectionId: "c2" })).not.toBe(key);
    expect(rateQuoteKey({ ...base, orderId: "o2" })).not.toBe(key);
  });
});

describe("expiringCache", () => {
  it("forgets entries after the time to live", () => {
    const cache = expiringCache<number>(1000, 10);
    cache.set("a", 1, 0);
    expect(cache.get("a", 999)).toBe(1);
    expect(cache.get("a", 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("drops the oldest entry once full", () => {
    const cache = expiringCache<number>(1000, 2);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    cache.set("a", 3, 0);
    cache.set("c", 4, 0);
    expect(cache.get("b", 1)).toBeUndefined();
    expect(cache.get("a", 1)).toBe(3);
    expect(cache.get("c", 1)).toBe(4);
  });
});

describe("mapWithLimit", () => {
  it("keeps the input order and never runs more than the limit", async () => {
    let running = 0;
    let most = 0;
    const out = await mapWithLimit([30, 5, 20, 1, 10, 2], 2, async (ms, index) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return index * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40, 50]);
    expect(most).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("passes a quick answer through", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, "slow")).resolves.toBe(7);
  });

  it("gives up on a slow one", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve(1), 200));
    await expect(withTimeout(slow, 5, "UPS did not answer")).rejects.toThrow("UPS did not answer");
  });
});
