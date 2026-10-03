import { describe, expect, it } from "vitest";
import {
  BACKDROPS,
  FINISHES,
  RENDER_ASPECTS,
  STUDIO_PRESETS,
  STUDIO_WHITE_KELVIN,
  backdropById,
  bakeSweepEnvironment,
  cadFileKind,
  cropFrame,
  cropVerticalFov,
  defaultFinishFor,
  encodeLabMeta,
  environmentIrradiance,
  finishById,
  fitDistance,
  frameDistance,
  hexToLinearRgb,
  isFinishId,
  isGlb,
  isLabModelSlug,
  kelvinToLinearRgb,
  labModelKey,
  labModelPrefix,
  lightTint,
  linearRgbToHex,
  modelNameFromFile,
  modelSeries,
  normalizeLabStats,
  parseLabMeta,
  partLabel,
  renderDimensions,
  renderFileName,
  renderTiles,
  rotateEquirect,
  slugFromLabKey,
  slugifyModelName,
  sortLabModels,
  studioDirection,
  studioEnvironmentPixels,
  studioPresetById,
  sweepHit,
  translatePartName,
  verticalFovForFocalLength,
} from "./cad-lab";

describe("files and names", () => {
  it("knows STEP, GLB, and zip by extension", () => {
    expect(cadFileKind("BX Cup Holder.stp")).toBe("step");
    expect(cadFileKind("bracket.STEP")).toBe("step");
    expect(cadFileKind("ax-1000.glb")).toBe("glb");
    expect(cadFileKind("product-line-step.zip")).toBe("zip");
    expect(cadFileKind("readme.txt")).toBeNull();
    expect(cadFileKind("model.gltf")).toBeNull();
  });

  it("names a model after its file, without folders or extension", () => {
    expect(modelNameFromFile("Assemblies/BX Cup Holder.stp")).toBe("BX Cup Holder");
    expect(modelNameFromFile("C:\\cad\\AX-1000.STEP")).toBe("AX-1000");
    expect(modelNameFromFile("game_controller  stand.glb")).toBe("game controller stand");
    expect(modelNameFromFile(".stp")).toBe("Model");
  });

  it("slugs names for storage keys", () => {
    expect(slugifyModelName("AX-1000")).toBe("ax-1000");
    expect(slugifyModelName("BX Lamp Arm With Clamp")).toBe("bx-lamp-arm-with-clamp");
    expect(slugifyModelName("  Café   Stand (v2) ")).toBe("cafe-stand-v2");
    expect(slugifyModelName("桌板")).toBe("model");
    expect(slugifyModelName("x".repeat(200))).toHaveLength(80);
    expect(isLabModelSlug(slugifyModelName("-".repeat(5) + "a".repeat(100)))).toBe(true);
  });

  it("only accepts plain slugs", () => {
    expect(isLabModelSlug("ax-1000")).toBe(true);
    expect(isLabModelSlug("a")).toBe(true);
    expect(isLabModelSlug("../secrets")).toBe(false);
    expect(isLabModelSlug("ax/1000")).toBe(false);
    expect(isLabModelSlug("-ax")).toBe(false);
    expect(isLabModelSlug("ax-")).toBe(false);
    expect(isLabModelSlug("ax--1000")).toBe(false);
    expect(isLabModelSlug("AX-1000")).toBe(false);
    expect(isLabModelSlug("")).toBe(false);
    expect(isLabModelSlug("a".repeat(81))).toBe(false);
  });

  it("reads the product family from the name", () => {
    expect(modelSeries("AX-1000")).toBe("AX");
    expect(modelSeries("AX420")).toBe("AX");
    expect(modelSeries("BX Cup Holder")).toBe("BX");
    expect(modelSeries("Bench Clamp")).toBeNull();
    expect(modelSeries("Bx Cup")).toBeNull();
  });

  it("sorts families together and numbers in order", () => {
    const names = ["AX-1200", "Bench Clamp", "BX Pen Tray", "AX-800", "BX Cup Holder", "AX-1000", "AX420"];
    expect(sortLabModels(names.map((name) => ({ name }))).map((m) => m.name)).toEqual([
      "AX-800",
      "AX-1000",
      "AX-1200",
      "AX420",
      "BX Cup Holder",
      "BX Pen Tray",
      "Bench Clamp",
    ]);
  });
});

describe("part names", () => {
  it("translates Chinese CAD names and keeps numbering", () => {
    expect(translatePartName("桌腿沉头")).toBe("Leg countersunk");
    expect(translatePartName("支架不沉头")).toBe("Bracket non-countersunk");
    expect(translatePartName("侧面插槽-3")).toBe("Side slot - 3");
    expect(translatePartName("侧面插槽- 3")).toBe("Side slot - 3");
    expect(translatePartName("桌板主体组件-600")).toBe("Desk panel main body assembly - 600");
    expect(translatePartName("铝板折弯线槽")).toBe("Aluminum panel bent cable tray");
    expect(translatePartName("实体4_1")).toBe("Body 4_1");
    expect(translatePartName("转盘插条_1")).toBe("Turntable insert strip_1");
    expect(translatePartName("AB200-左斜2")).toBe("AB200 - left bevel 2");
    expect(translatePartName("笔记本支架顶板")).toBe("Laptop bracket top plate");
    expect(translatePartName("耳机挂架-可转动")).toBe("Headset hanger - rotating");
    expect(translatePartName("手机无线充衬套")).toBe("Phone wireless charging sleeve");
    expect(translatePartName("压缩弹簧")).toBe("Compression spring");
    expect(translatePartName("PAD支架")).toBe("PAD bracket");
  });

  it("leaves names without Chinese alone", () => {
    expect(translatePartName("ISO 4762 - M4 x 10")).toBeNull();
    expect(translatePartName("logo")).toBeNull();
  });

  it("keeps unknown Chinese terms in the reading", () => {
    expect(translatePartName("桌腿龙")).toBe("Leg 龙");
    expect(translatePartName("龙")).toBeNull();
  });

  it("labels a part with the English reading first", () => {
    expect(partLabel("桌腿")).toEqual({ primary: "Leg", secondary: "桌腿" });
    expect(partLabel("JIS B 1111 - A M3 x 4 - Z(2)")).toEqual({ primary: "JIS B 1111 - A M3 x 4 - Z(2)", secondary: null });
    expect(partLabel("   ")).toEqual({ primary: "Unnamed part", secondary: null });
  });
});

describe("finishes", () => {
  it("has unique ids and physically sane values", () => {
    expect(new Set(FINISHES.map((f) => f.id)).size).toBe(FINISHES.length);
    for (const finish of FINISHES) {
      expect(finish.metalness).toBeGreaterThanOrEqual(0);
      expect(finish.metalness).toBeLessThanOrEqual(1);
      expect(finish.roughness).toBeGreaterThanOrEqual(0);
      expect(finish.roughness).toBeLessThanOrEqual(1);
      expect(finish.color === "cad" || /^#[0-9a-f]{6}$/.test(finish.color)).toBe(true);
      if (finish.transmission) expect(finish.ior).toBeGreaterThan(1);
    }
  });

  it("falls back to silver aluminum for an unknown id", () => {
    expect(finishById("nope").id).toBe("anodized-silver");
    expect(isFinishId("felt-charcoal")).toBe(true);
    expect(isFinishId("nope")).toBe(false);
  });

  it("makes standard parts and springs steel whatever their color", () => {
    expect(defaultFinishFor("ISO 4762 - M4 x 10", [0.07, 0.07, 0.07])).toBe("stainless-steel");
    expect(defaultFinishFor("JIS B 1111 - M3 x 6", [0.5, 0.49, 0.48])).toBe("stainless-steel");
    expect(defaultFinishFor("CSN 021702 - 4", null)).toBe("stainless-steel");
    expect(defaultFinishFor("BS 4168 - M2 x 4", null)).toBe("stainless-steel");
    expect(defaultFinishFor("压缩弹簧-3", [0.74, 0.73, 0.7])).toBe("stainless-steel");
    expect(defaultFinishFor("弹性螺母", [0.521, 0.521, 0.521])).toBe("stainless-steel");
    expect(defaultFinishFor("M3手拧螺钉", null)).toBe("stainless-steel");
  });

  it("does not mistake ordinary names for standards", () => {
    expect(defaultFinishFor("End cap 2", null)).toBe("anodized-silver");
    expect(defaultFinishFor("Base 12", [0.07, 0.07, 0.07])).toBe("satin-black");
  });

  it("reads felt, pads, and the screw cover by name", () => {
    expect(defaultFinishFor("侧面毛毡", [0.521, 0.521, 0.521])).toBe("felt-charcoal");
    expect(defaultFinishFor("桌脚防滑垫", null)).toBe("rubber-black");
    expect(defaultFinishFor("螺丝贴", null)).toBe("satin-black");
    expect(defaultFinishFor("螺丝贴", [0.98, 0.98, 0.98])).toBe("powder-white");
  });

  it("maps CAD colors to finishes", () => {
    expect(defaultFinishFor("支架-左斜1", [0.521, 0.521, 0.521])).toBe("anodized-silver");
    expect(defaultFinishFor("桌板-600", [0.42, 0.42, 0.42])).toBe("anodized-space-gray");
    expect(defaultFinishFor("侧面插槽-3", [0.07, 0.07, 0.07])).toBe("satin-black");
    expect(defaultFinishFor("part", [0.2, 0.2, 0.2])).toBe("anodized-black");
    expect(defaultFinishFor("桌腿沉头", [0.98, 0.98, 0.98])).toBe("powder-white");
    expect(defaultFinishFor("轨道", [0.7, 0.2, 0.02])).toBe("cad-satin");
    expect(defaultFinishFor("", null)).toBe("anodized-silver");
  });

  it("writes linear colors as sRGB hex", () => {
    expect(linearRgbToHex([0, 0, 0])).toBe("#000000");
    expect(linearRgbToHex([1, 1, 1])).toBe("#ffffff");
    expect(linearRgbToHex([0.521, 0.521, 0.521])).toBe("#bfbfbf");
    expect(linearRgbToHex([2, -1, 0.5])).toBe("#ff00bc");
  });
});

describe("studio lighting", () => {
  it("has distinct presets and falls back to the softbox", () => {
    expect(new Set(STUDIO_PRESETS.map((p) => p.id)).size).toBe(STUDIO_PRESETS.length);
    expect(studioPresetById("missing").id).toBe("softbox");
  });

  it("turns color temperature into a normalized tint", () => {
    const daylight = kelvinToLinearRgb(6500);
    expect(Math.max(...daylight)).toBeCloseTo(1, 5);
    expect(Math.min(...daylight)).toBeGreaterThan(0.85);
    const tungsten = kelvinToLinearRgb(2700);
    expect(tungsten[0]).toBe(1);
    expect(tungsten[2]).toBeLessThan(tungsten[1]);
    expect(kelvinToLinearRgb(12000)[2]).toBe(1);
  });

  it("white-balances lights to studio daylight", () => {
    expect(lightTint(STUDIO_WHITE_KELVIN).map((v) => Number(v.toFixed(6)))).toEqual([1, 1, 1]);
    const warm = lightTint(3200);
    expect(warm[0]).toBe(1);
    expect(warm[1]).toBeLessThan(1);
    expect(warm[2]).toBeLessThan(warm[1]);
    const cool = lightTint(9000);
    expect(cool[2]).toBe(1);
    expect(cool[0]).toBeLessThan(1);
    // A slightly cooler rim light is only slightly blue.
    expect(Math.min(...lightTint(6000))).toBeGreaterThan(0.85);
  });

  it("points azimuth 0 at the camera side and 90 to the right", () => {
    const front = studioDirection(0, 0);
    expect(front[2]).toBeCloseTo(1);
    const right = studioDirection(90, 0);
    expect(right[0]).toBeCloseTo(1);
    const top = studioDirection(0, 90);
    expect(top[1]).toBeCloseTo(1);
  });

  it("lays softboxes out where three.js samples their direction", () => {
    const preset = {
      ...STUDIO_PRESETS[0]!,
      top: [0, 0, 0] as [number, number, number],
      horizon: [0, 0, 0] as [number, number, number],
      bottom: [0, 0, 0] as [number, number, number],
      softboxes: [{ azimuth: 90, elevation: 0, width: 20, height: 20, intensity: 5, kelvin: STUDIO_WHITE_KELVIN, softness: 0 }],
    };
    const width = 256;
    const height = 128;
    const pixels = studioEnvironmentPixels(preset, width, height);
    expect(pixels).toHaveLength(width * height * 4);
    // three.js: u = atan2(z, x) / 2π + 0.5 and v = asin(y) / π + 0.5, so +X at the horizon is the middle texel.
    const at = (u: number, v: number) => {
      const i = Math.min(width - 1, Math.floor(u * width));
      const j = Math.min(height - 1, Math.floor(v * height));
      return pixels[(j * width + i) * 4]!;
    };
    expect(at(0.5, 0.5)).toBeCloseTo(5);
    expect(at(0.25, 0.5)).toBe(0); // -Z
    expect(at(0.0, 0.5)).toBe(0); // -X
    expect(at(0.5, 0.95)).toBe(0); // overhead
    expect(pixels[3]).toBe(1);
  });

  it("keeps an overhead box square instead of smearing it across the pole", () => {
    const preset = {
      ...STUDIO_PRESETS[0]!,
      top: [0, 0, 0] as [number, number, number],
      horizon: [0, 0, 0] as [number, number, number],
      bottom: [0, 0, 0] as [number, number, number],
      softboxes: [{ azimuth: 0, elevation: 90, width: 30, height: 30, intensity: 1, kelvin: 6500, softness: 0 }],
    };
    const pixels = studioEnvironmentPixels(preset, 128, 64);
    let lit = 0;
    let litLowest = 64;
    for (let j = 0; j < 64; j++) {
      for (let i = 0; i < 128; i++) {
        if (pixels[(j * 128 + i) * 4]! > 0.5) {
          lit++;
          litLowest = Math.min(litLowest, j);
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
    // A 30° box overhead reaches down to about 69° latitude at its corners: the top ~8 rows of 64.
    expect(litLowest).toBeGreaterThanOrEqual(64 - 11);
  });

  it("knows which directions from the product land on the sweep", () => {
    expect(sweepHit([0, -1, 0], 0.5)).toBe("floor");
    expect(sweepHit([0, -0.2, 0.98], 0.5)).toBe("floor");
    expect(sweepHit([0, 0, -1], 0.5)).toBe("wall");
    expect(sweepHit([0, 0.4, -0.92], 0.5)).toBe("wall");
    // Down and back, into the curve between the floor and the wall.
    expect(sweepHit([0, -0.3, -0.954], 0.5)).toBe("wall");
    expect(sweepHit([0, -0.15, -0.989], 0.5)).toBe("wall");
    expect(sweepHit([0, 1, 0], 0.5)).toBeNull();
    expect(sweepHit([0, 0.3, 0.95], 0.5)).toBeNull();
    // Over the top of the wall, past the sides, and beyond the front edge of the floor see the studio.
    expect(sweepHit([0, 0.99, -0.14], 0.5)).toBeNull();
    expect(sweepHit([-1, -0.01, 0], 0.5)).toBeNull();
    expect(sweepHit([0, -0.01, 1], 0.5)).toBeNull();
  });

  it("integrates irradiance like a uniform sky gives π·L", () => {
    const width = 128;
    const height = 64;
    const sky = new Float32Array(width * height * 4).fill(1);
    const e = environmentIrradiance(sky, width, height, [0, 1, 0], 1);
    expect(e[0]).toBeCloseTo(Math.PI, 1);
    const half = environmentIrradiance(sky, width, height, [0, 0, 1], 1);
    expect(half[1]).toBeCloseTo(Math.PI, 1);
  });

  it("turns the studio the way three.js turns an environment", () => {
    const width = 256;
    const height = 128;
    const preset = {
      ...STUDIO_PRESETS[0]!,
      top: [0, 0, 0] as [number, number, number],
      horizon: [0, 0, 0] as [number, number, number],
      bottom: [0, 0, 0] as [number, number, number],
      softboxes: [{ azimuth: 0, elevation: 0, width: 20, height: 20, intensity: 1, kelvin: STUDIO_WHITE_KELVIN, softness: 0 }],
    };
    const pixels = studioEnvironmentPixels(preset, width, height);
    const at = studioPixelsAt(rotateEquirect(pixels, width, height, Math.PI / 2), width, height);
    // Azimuth 0 turned by +90° lands at azimuth 90, which is +X.
    expect(at(studioDirection(90, 0))).toBeCloseTo(1);
    expect(at(studioDirection(0, 0))).toBe(0);
    expect(rotateEquirect(pixels, width, height, 0)).toBe(pixels);
    expect(rotateEquirect(pixels, width, height, Math.PI * 2)).toBe(pixels);
  });

  it("paints the sweep into the studio as lit paper", () => {
    const width = 128;
    const height = 64;
    const sky = new Float32Array(width * height * 4).fill(1);
    const baked = studioPixelsAt(bakeSweepEnvironment(sky, width, height, [0.5, 0.5, 0.5], 0.5), width, height);
    // Straight down is the floor: 0.5 × π × 1 / π.
    expect(baked([0, -1, 0])).toBeCloseTo(0.5, 1);
    // Straight up is still the studio.
    expect(baked([0, 1, 0])).toBe(1);
    expect(hexToLinearRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToLinearRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToLinearRgb("bfbfbf")[0]).toBeCloseTo(0.521, 2);
  });

  it("puts every studio light where the sweep does not hide it", () => {
    // Lights behind the sweep's wall would be blocked by the path tracer and missing from the preview.
    for (const preset of STUDIO_PRESETS) {
      for (const box of preset.softboxes) {
        for (const probe of [0.1, 0.5, 0.9]) {
          expect(sweepHit(studioDirection(box.azimuth, box.elevation), probe), `${preset.id} at ${box.azimuth}°/${box.elevation}°`).toBeNull();
        }
      }
    }
  });

  it("fills the surround from the preset gradient", () => {
    const preset = studioPresetById("high-key");
    const pixels = studioEnvironmentPixels({ ...preset, softboxes: [] }, 16, 8);
    const topRow = pixels[(7 * 16) * 4]!;
    const bottomRow = pixels[0]!;
    expect(topRow).toBeGreaterThan(bottomRow);
    expect(Array.from(pixels).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
});

/** Sample an equirect at a direction, three.js layout. */
function studioPixelsAt(pixels: Float32Array, width: number, height: number) {
  return ([x, y, z]: [number, number, number]) => {
    const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
    const v = Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI + 0.5;
    const i = Math.min(width - 1, Math.floor(u * width));
    const j = Math.min(height - 1, Math.floor(v * height));
    return pixels[(j * width + i) * 4]!;
  };
}

describe("camera and renders", () => {
  it("converts focal length to a full-frame vertical field of view", () => {
    expect(verticalFovForFocalLength(50)).toBeCloseTo(26.99, 1);
    expect(verticalFovForFocalLength(35)).toBeCloseTo(37.85, 1);
    expect(verticalFovForFocalLength(85)).toBeLessThan(verticalFovForFocalLength(50));
  });

  it("backs the camera off further for narrow frames and tighter lenses", () => {
    const wide = frameDistance(1, 30, 16 / 9);
    const tall = frameDistance(1, 30, 9 / 16);
    expect(tall).toBeGreaterThan(wide);
    expect(frameDistance(1, 15, 1)).toBeGreaterThan(frameDistance(1, 30, 1));
    expect(frameDistance(2, 30, 1)).toBeCloseTo(frameDistance(1, 30, 1) * 2);
    // The sphere fits: radius / distance = sin(half fov) / margin.
    expect(1 / frameDistance(1, 30, 1, 1)).toBeCloseTo(Math.sin((15 * Math.PI) / 180));
  });

  it("crops a render to the frame drawn over the viewer", () => {
    // Narrower than the viewer: same height, same vertical field of view.
    expect(cropVerticalFov(16 / 9, 1, 30)).toBe(30);
    expect(cropFrame(16 / 9, 1)).toEqual({ width: 9 / 16, height: 1 });
    // Wider than the viewer: full width, less height, a tighter vertical field of view.
    const fov = cropVerticalFov(1, 16 / 9, 30);
    expect(fov).toBeLessThan(30);
    expect(Math.tan((fov * Math.PI) / 360)).toBeCloseTo(Math.tan((30 * Math.PI) / 360) * (9 / 16));
    expect(cropFrame(1, 16 / 9)).toEqual({ width: 1, height: 9 / 16 });
    expect(cropFrame(0, 1)).toEqual({ width: 1, height: 1 });
  });

  it("fits the camera to the corners, not a loose sphere", () => {
    // A 1 m wide, 0.1 m tall slab seen square on: width decides at a wide aspect.
    const slab: [number, number, number][] = [];
    for (const x of [-0.5, 0.5]) for (const y of [-0.05, 0.05]) for (const z of [-0.1, 0.1]) slab.push([x, y, z]);
    const d = fitDistance(slab, 30, 16 / 9, 1);
    const tanH = Math.tan((15 * Math.PI) / 180) * (16 / 9);
    expect(d).toBeCloseTo(0.1 + 0.5 / tanH);
    // In a tall frame it backs off further, and margin adds room.
    expect(fitDistance(slab, 30, 9 / 16, 1)).toBeGreaterThan(d);
    expect(fitDistance(slab, 30, 16 / 9, 1.2)).toBeGreaterThan(d);
    // Much closer than fitting the slab's bounding sphere.
    expect(d).toBeLessThan(frameDistance(Math.hypot(0.5, 0.05, 0.1), 30, 16 / 9, 1));
    expect(fitDistance([], 30, 1)).toBe(0);
  });

  it("sizes renders by the long edge with even pixels", () => {
    expect(renderDimensions(16 / 9, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(renderDimensions(1, 2560)).toEqual({ width: 2560, height: 2560 });
    expect(renderDimensions(4 / 5, 1920)).toEqual({ width: 1536, height: 1920 });
    expect(renderDimensions(3 / 2, 1280)).toEqual({ width: 1280, height: 854 });
    expect(renderDimensions(Number.NaN, 1000)).toEqual({ width: 1000, height: 1000 });
    const odd = renderDimensions(1.37, 1001);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
  });

  it("tiles big renders", () => {
    expect(renderTiles(1280, 720)).toEqual({ x: 1, y: 1 });
    expect(renderTiles(2560, 1440)).toEqual({ x: 2, y: 2 });
    expect(renderTiles(3840, 2160)).toEqual({ x: 3, y: 3 });
  });

  it("names the download after the model, studio, and size", () => {
    expect(renderFileName("BX Cup Holder", "softbox", 1920, 1080)).toBe("bx-cup-holder-softbox-1920x1080.png");
  });

  it("has a viewer-matched aspect and a fallback backdrop", () => {
    expect(RENDER_ASPECTS[0]!.ratio).toBeNull();
    expect(backdropById("missing").id).toBe(BACKDROPS[0]!.id);
    expect(BACKDROPS.filter((b) => b.background === "sweep").every((b) => b.color)).toBe(true);
  });
});

describe("library storage", () => {
  it("keys models under the organization's media prefix", () => {
    expect(labModelPrefix("org_1")).toBe("org/org_1/lab/cad/");
    expect(labModelKey("org_1", "ax-1000")).toBe("org/org_1/lab/cad/ax-1000.glb");
    expect(slugFromLabKey("org_1", "org/org_1/lab/cad/ax-1000.glb")).toBe("ax-1000");
    expect(slugFromLabKey("org_2", "org/org_1/lab/cad/ax-1000.glb")).toBeNull();
    expect(slugFromLabKey("org_1", "org/org_1/lab/cad/nested/x.glb")).toBeNull();
    expect(slugFromLabKey("org_1", "org/org_1/items/abc")).toBeNull();
  });

  const stats = {
    name: "  AX-1000 ",
    parts: 40,
    triangles: 120000,
    sizeMm: [300, 110.44, 900],
    sourceName: "AX-1000.stp",
    sourceBytes: 2000000,
  };

  it("cleans upload stats", () => {
    expect(normalizeLabStats(stats)).toEqual({
      name: "AX-1000",
      parts: 40,
      triangles: 120000,
      sizeMm: [300, 110.4, 900],
      sourceName: "AX-1000.stp",
      sourceBytes: 2000000,
    });
    expect(normalizeLabStats({ ...stats, sourceName: undefined, sourceBytes: undefined }).sourceName).toBe("AX-1000");
  });

  it("rejects bad upload stats", () => {
    expect(() => normalizeLabStats(null)).toThrow("meta must be an object");
    expect(() => normalizeLabStats({ ...stats, name: " " })).toThrow("name is required");
    expect(() => normalizeLabStats({ ...stats, parts: -1 })).toThrow("parts");
    expect(() => normalizeLabStats({ ...stats, triangles: 1.5 })).toThrow("triangles");
    expect(() => normalizeLabStats({ ...stats, sizeMm: [1, 2] })).toThrow("sizeMm");
    expect(() => normalizeLabStats({ ...stats, sizeMm: [1, 2, Number.POSITIVE_INFINITY] })).toThrow("sizeMm");
  });

  it("round-trips metadata through R2 custom metadata", () => {
    const meta = { ...normalizeLabStats(stats), uploadedBy: "brian@ventr.it", uploadedAt: 1_790_000_000_000 };
    const encoded = encodeLabMeta(meta);
    expect(Object.values(encoded).every((v) => typeof v === "string")).toBe(true);
    expect(JSON.stringify(encoded).length).toBeLessThan(2048);
    expect(parseLabMeta(encoded, "fallback")).toEqual(meta);
  });

  it("falls back when metadata is missing or broken", () => {
    expect(parseLabMeta(undefined, "ax-1000").name).toBe("ax-1000");
    expect(parseLabMeta({ lab: "{not json" }, "x").parts).toBe(0);
  });

  it("recognizes binary glTF 2.0", () => {
    const glb = new Uint8Array(20);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    expect(isGlb(glb)).toBe(true);
    view.setUint32(4, 1, true);
    expect(isGlb(glb)).toBe(false);
    expect(isGlb(new TextEncoder().encode("ISO-10303-21; HEADER;"))).toBe(false);
    expect(isGlb(new Uint8Array(4))).toBe(false);
  });
});
