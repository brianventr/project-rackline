import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, DEFAULT_RENDER, DEFAULT_SETTINGS, cleanLook, cleanRender, cleanSettings } from "./lab-state";

describe("remembered lab settings", () => {
  it("keeps valid per-model settings", () => {
    expect(
      cleanSettings({
        assign: { p0: "stainless-steel" },
        tints: { "anodized-silver": "#AABBCC" },
        hidden: ["p3"],
        orientation: { turn: 1, tip: 2, roll: 3 },
      }),
    ).toEqual({
      assign: { p0: "stainless-steel" },
      tints: { "anodized-silver": "#aabbcc" },
      hidden: ["p3"],
      orientation: { turn: 1, tip: 2, roll: 3 },
    });
  });

  it("drops unknown finishes, bad colors, and odd turns", () => {
    expect(
      cleanSettings({
        assign: { p0: "gold-leaf", p1: 7 as unknown as string },
        tints: { "anodized-silver": "red", "not-a-finish": "#ffffff" },
        hidden: ["p1", 4 as unknown as string],
        orientation: { turn: 5, tip: -1, roll: 1.5 },
      }),
    ).toEqual({ assign: {}, tints: {}, hidden: ["p1"], orientation: { turn: 1, tip: 3, roll: 0 } });
    expect(cleanSettings(null)).toBe(DEFAULT_SETTINGS);
    expect(cleanSettings("x" as never)).toBe(DEFAULT_SETTINGS);
  });

  it("clamps the look and falls back on unknown choices", () => {
    expect(cleanLook(null)).toBe(DEFAULT_LOOK);
    const look = cleanLook({ studio: "disco", backdrop: "charcoal", exposure: 9, envIntensity: Number.NaN, lens: 70, fStop: 2.8, toneMapping: "agx", dof: true });
    expect(look).toMatchObject({ studio: "softbox", backdrop: "charcoal", exposure: 2, envIntensity: 1, lens: 50, fStop: 2.8, toneMapping: "agx", dof: true });
  });

  it("limits render settings to what the panel offers", () => {
    expect(cleanRender(null)).toBe(DEFAULT_RENDER);
    expect(cleanRender({ aspect: "21:9", longEdge: 99999, quality: "final", denoise: false, bounces: Number.NaN })).toEqual({
      aspect: "view",
      longEdge: 1920,
      quality: "final",
      denoise: false,
      bounces: 8,
    });
    expect(cleanRender({ aspect: "1:1", longEdge: 3840, quality: "draft", denoise: true, bounces: 14 })).toEqual({
      aspect: "1:1",
      longEdge: 3840,
      quality: "draft",
      denoise: true,
      bounces: 14,
    });
  });
});
