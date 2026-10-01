import { describe, expect, it } from "vitest";
import { parseScaleReport, type ScaleReading } from "./scale-report";
import { matchShipScan, stationWeight } from "./ship-station";

const orders = [
  { id: "08ec7dd1-c4d6-4585-b30b-95a5231b3bac", number: "ORD-WAVE1" },
  { id: "b2", number: "ORD-WAVE2" },
  { id: "c3", number: "#4401" },
  { id: "d4", number: "Etsy 3100078467" },
  { id: "e5", number: "ORD-A1" },
  { id: "f6", number: "SO-A1" },
  { id: "g7", number: "#1004" },
];

describe("matchShipScan", () => {
  it("matches the number printed on the pack slip", () => {
    expect(matchShipScan("ORD-WAVE1", orders)?.id).toBe("08ec7dd1-c4d6-4585-b30b-95a5231b3bac");
    expect(matchShipScan("  ord-wave2 \n", orders)?.id).toBe("b2");
  });

  it("matches with or without the hash and ignores spaces", () => {
    expect(matchShipScan("#4401", orders)?.id).toBe("c3");
    expect(matchShipScan("4401", orders)?.id).toBe("c3");
    expect(matchShipScan("ETSY3100078467", orders)?.id).toBe("d4");
    expect(matchShipScan("Etsy 3100078467", orders)?.id).toBe("d4");
  });

  it("keeps numbers that look like GS1 codes as order numbers", () => {
    expect(matchShipScan("1004", orders)?.id).toBe("g7");
  });

  it("takes an order prefix or the order id", () => {
    expect(matchShipScan("ORD:ORD-WAVE2", orders)?.id).toBe("b2");
    expect(matchShipScan("SO:#4401", orders)?.id).toBe("c3");
    expect(matchShipScan("08EC7DD1-C4D6-4585-B30B-95A5231B3BAC", orders)?.number).toBe("ORD-WAVE1");
  });

  it("matches the part after the dash only when one order ends that way", () => {
    expect(matchShipScan("WAVE1", orders)?.id).toBe("08ec7dd1-c4d6-4585-b30b-95a5231b3bac");
    expect(matchShipScan("A1", orders)).toBeNull();
  });

  it("does not take other kinds of barcode or unknown numbers", () => {
    expect(matchShipScan("LOC:A-01-01", orders)).toBeNull();
    expect(matchShipScan("SKU:LAMP", orders)).toBeNull();
    expect(matchShipScan("ORD-NOPE", orders)).toBeNull();
    expect(matchShipScan("   ", orders)).toBeNull();
  });
});

describe("stationWeight", () => {
  const reading = (status: number, tenths: number): ScaleReading => parseScaleReport([status, 11, 0xff, tenths & 0xff, tenths >> 8])!;
  const scale = (value: ScaleReading | null) => ({ connected: true, reading: value });
  const noScale = { connected: false, reading: null };

  it("sends a typed weight first, rounded up to whole ounces", () => {
    expect(stationWeight({ typed: "12.2", scale: scale(reading(4, 200)), computedOz: 9 })).toEqual({ ok: true, weightOz: 13, source: "typed" });
    expect(stationWeight({ typed: "abc", scale: noScale })).toMatchObject({ ok: false });
    expect(stationWeight({ typed: "0", scale: noScale })).toMatchObject({ ok: false });
  });

  it("uses a settled scale weight", () => {
    expect(stationWeight({ typed: "", scale: scale(reading(4, 121)), computedOz: 9 })).toEqual({ ok: true, weightOz: 13, source: "scale" });
  });

  it("waits for the scale instead of falling back to a guess", () => {
    expect(stationWeight({ typed: "", scale: scale(reading(3, 121)), computedOz: 9 })).toEqual({
      ok: false,
      error: "Wait for the scale to settle.",
    });
    expect(stationWeight({ typed: "", scale: scale(reading(2, 0)), computedOz: 9 })).toMatchObject({ error: /Put the box on the scale/ });
    expect(stationWeight({ typed: "", scale: scale(null), computedOz: 9 })).toMatchObject({ ok: false });
    expect(stationWeight({ typed: "", scale: scale(reading(6, 0)) })).toMatchObject({ error: /limit\. Type the weight/ });
  });

  it("falls back to the queue's weight without a scale", () => {
    expect(stationWeight({ typed: " ", scale: noScale, computedOz: 14 })).toEqual({ ok: true, weightOz: 14, source: "order" });
    expect(stationWeight({ typed: "", scale: noScale, computedOz: null })).toEqual({
      ok: false,
      error: "Type the weight, or connect a scale.",
    });
  });
});
