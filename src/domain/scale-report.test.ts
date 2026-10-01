import { describe, expect, it } from "vitest";
import {
  FRESH_SCALE_WATCH,
  formatScaleValue,
  labelOunces,
  parseScaleReport,
  scaleStatusWords,
  watchScale,
  type ScaleReading,
} from "./scale-report";

const STABLE = 4;
const OZ = 11;
const LB = 12;
const G = 2;
const KG = 3;
const TENTHS = 0xff;

function report(status: number, unit: number, exponent: number, weight: number): number[] {
  return [status, unit, exponent, weight & 0xff, (weight >> 8) & 0xff];
}

describe("parseScaleReport", () => {
  it("reads a stable weight in tenths of an ounce", () => {
    expect(parseScaleReport(report(STABLE, OZ, TENTHS, 123))).toEqual({
      status: "stable",
      unit: "oz",
      value: 12.3,
      weightOz: 12.3,
      stable: true,
    });
  });

  it("reads the weight as little-endian 16 bits", () => {
    expect(parseScaleReport([STABLE, OZ, 0, 0x2c, 0x01])?.value).toBe(300);
    expect(parseScaleReport(report(STABLE, OZ, TENTHS, 0xffff))?.value).toBe(6553.5);
  });

  it("turns grams, kilograms, and pounds into ounces", () => {
    expect(parseScaleReport(report(STABLE, G, 0, 340))?.weightOz).toBeCloseTo(11.993, 3);
    expect(parseScaleReport(report(STABLE, KG, 0xfd, 1250))).toMatchObject({ unit: "kg", value: 1.25 });
    expect(parseScaleReport(report(STABLE, KG, 0xfd, 1250))?.weightOz).toBeCloseTo(44.09, 2);
    expect(parseScaleReport(report(STABLE, LB, 0xfe, 125))).toMatchObject({ unit: "lb", value: 1.25, weightOz: 20 });
  });

  it("uses a positive exponent as a multiplier", () => {
    expect(parseScaleReport(report(STABLE, G, 1, 25))?.value).toBe(250);
  });

  it("tells a moving weight from a settled one", () => {
    expect(parseScaleReport(report(3, OZ, TENTHS, 80))).toMatchObject({ status: "motion", stable: false, weightOz: 8 });
  });

  it("reads an empty scale as a stable zero", () => {
    expect(parseScaleReport(report(2, OZ, TENTHS, 0))).toMatchObject({ status: "zero", value: 0, weightOz: 0, stable: true });
  });

  it("reads under zero as negative, whether sent as a size or a negative number", () => {
    expect(parseScaleReport(report(5, OZ, TENTHS, 15))).toMatchObject({ status: "under_zero", value: -1.5, stable: false });
    expect(parseScaleReport(report(5, OZ, TENTHS, 0x10000 - 15))?.value).toBe(-1.5);
  });

  it("has no weight while the scale is faulted, overloaded, or needs attention", () => {
    for (const status of [1, 6, 7, 8]) {
      const reading = parseScaleReport(report(status, OZ, TENTHS, 50));
      expect(reading?.weightOz).toBeNull();
      expect(reading?.stable).toBe(false);
    }
    expect(scaleStatusWords(parseScaleReport(report(6, OZ, 0, 0))!)).toBe("Over the scale's limit");
  });

  it("shows taels but never guesses their ounces", () => {
    expect(parseScaleReport(report(STABLE, 5, 0, 3))).toMatchObject({ unit: "tael", value: 3, weightOz: null });
  });

  it("skips reports that are not weights", () => {
    expect(parseScaleReport([STABLE, OZ, 0, 1])).toBeNull();
    expect(parseScaleReport(report(0, OZ, 0, 1))).toBeNull();
    expect(parseScaleReport(report(9, OZ, 0, 1))).toBeNull();
    expect(parseScaleReport(report(STABLE, 13, 0, 1))).toBeNull();
    expect(parseScaleReport(report(STABLE, OZ, 0, 1), 4)).toBeNull();
    expect(parseScaleReport(report(STABLE, OZ, 0, 1), 0)).toMatchObject({ value: 1 });
  });

  it("formats the scale's own reading", () => {
    expect(formatScaleValue(parseScaleReport(report(STABLE, OZ, TENTHS, 123))!)).toBe("12.3 oz");
    expect(formatScaleValue(parseScaleReport(report(STABLE, G, 0, 340))!)).toBe("340 g");
  });
});

describe("labelOunces", () => {
  it("rounds a settled weight up to the next whole ounce", () => {
    expect(labelOunces(parseScaleReport(report(STABLE, OZ, TENTHS, 121)))).toBe(13);
    expect(labelOunces(parseScaleReport(report(STABLE, OZ, TENTHS, 120)))).toBe(12);
    expect(labelOunces(parseScaleReport(report(STABLE, OZ, TENTHS, 3)))).toBe(1);
    expect(labelOunces(parseScaleReport(report(STABLE, G, 0, 340)))).toBe(12);
  });

  it("has no label weight until the scale settles above zero", () => {
    expect(labelOunces(parseScaleReport(report(3, OZ, TENTHS, 120)))).toBeNull();
    expect(labelOunces(parseScaleReport(report(2, OZ, TENTHS, 0)))).toBeNull();
    expect(labelOunces(parseScaleReport(report(5, OZ, TENTHS, 10)))).toBeNull();
    expect(labelOunces(null)).toBeNull();
  });
});

describe("watchScale", () => {
  const read = (status: number, tenths: number): ScaleReading => parseScaleReport(report(status, OZ, TENTHS, tenths))!;

  function run(readings: ScaleReading[]) {
    let watch = FRESH_SCALE_WATCH;
    return readings.map((reading) => {
      const next = watchScale(watch, reading);
      watch = next.watch;
      return next.fire;
    });
  }

  it("fires once the box lands and settles after the order comes up", () => {
    expect(run([read(2, 0), read(3, 60), read(STABLE, 120), read(STABLE, 120)])).toEqual([false, false, true, false]);
  });

  it("waits for the last box to come off before firing", () => {
    expect(run([read(STABLE, 200), read(STABLE, 200), read(3, 90), read(STABLE, 120)])).toEqual([false, false, false, true]);
  });

  it("never fires on a fault or an under-zero reading", () => {
    expect(run([read(3, 10), read(5, 10), read(1, 0), read(6, 0)])).toEqual([false, false, false, false]);
  });
});
