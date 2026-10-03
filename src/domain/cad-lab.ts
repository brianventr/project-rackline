/**
 * The hidden CAD lab (/lab): product CAD in, studio renders out.
 * Pure helpers shared by the lab page, its conversion worker, and the /api/lab routes.
 */

export { CAD_LAB_PATH } from "./lab-path";

/* ------------------------------------------------------------------ files and names */

export type CadFileKind = "step" | "glb" | "zip";

/** What a dropped file is, by extension. Anything else is skipped. */
export function cadFileKind(fileName: string): CadFileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".stp") || lower.endsWith(".step")) return "step";
  if (lower.endsWith(".glb")) return "glb";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

/** "Assemblies/AX Cup Holder.stp" → "AX Cup Holder". */
export function modelNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const name = base.replace(/\.(stp|step|glb)$/i, "").replace(/[_\s]+/g, " ").trim();
  return name || "Model";
}

const MAX_SLUG = 80;

function trimSlug(slug: string, max: number): string {
  return slug.slice(0, max).replace(/-+$/g, "");
}

/** FNV-1a over code points, base 36: a short, stable fingerprint of a name. */
function nameHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * "AX-1000" → "ax-1000", "AX Cup Holder" → "ax-cup-holder". A name in another script ("底座", "装配体1")
 * keeps what ASCII can say plus a short hash of the whole name, so different names never share a key.
 * Never empty, at most 80 characters.
 */
export function slugifyModelName(name: string): string {
  const folded = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const ascii = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/[^\x00-\x7f]/.test(folded)) return trimSlug(ascii, MAX_SLUG) || "model";
  const hash = nameHash(name.normalize("NFC").trim());
  return `${trimSlug(ascii || "model", MAX_SLUG - hash.length - 1) || "model"}-${hash}`;
}

/**
 * Names and storage slugs for one batch of files. Two files called "Bracket" (from different folders)
 * become "Bracket" and "Bracket 2"; every slug handed out is reserved, so a later "Bracket 2.step" gets
 * "Bracket 2 2" instead of overwriting, and the suffix survives the 80-character limit.
 */
export function uniqueModelNames(fileNames: string[]): { name: string; slug: string }[] {
  const used = new Set<string>();
  return fileNames.map((fileName) => {
    const base = modelNameFromFile(fileName);
    const root = slugifyModelName(base);
    let name = base;
    let slug = root;
    for (let n = 2; used.has(slug); n++) {
      name = `${base} ${n}`;
      slug = `${trimSlug(root, MAX_SLUG - String(n).length - 1)}-${n}`;
    }
    used.add(slug);
    return { name, slug };
  });
}

/**
 * Zip tools that do not set the UTF-8 flag (Explorer on a Chinese-locale Windows, some Finder builds)
 * leave entry names that fflate reads as Latin-1. Read the same bytes as UTF-8, then GBK, and keep the
 * name as it came when neither fits.
 */
export function zipEntryName(raw: string): string {
  if (!/[\x80-\xff]/.test(raw) || /[^\x00-\xff]/.test(raw)) return raw;
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  for (const label of ["utf-8", "gbk"]) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      /* Not this encoding; try the next. */
    }
  }
  return raw;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function isLabModelSlug(value: string): boolean {
  return SLUG_RE.test(value) && !value.includes("--");
}

/**
 * The product family a model name starts with: "AX-1000" → "AX", "BX Cup Holder" → "BX".
 * Names without a short uppercase prefix group under null.
 */
export function modelSeries(name: string): string | null {
  const match = /^([A-Z]{2,4})(?=[\s-]?\d|\s)/.exec(name.trim());
  return match ? match[1]! : null;
}

/* ------------------------------------------------------------------ part names */

/**
 * CAD exported from Chinese-language SolidWorks names parts in Chinese. A small dictionary of hardware and
 * furniture words, composed term by term ("手机" + "支架" reads "phone bracket"); longest terms first so
 * "压缩弹簧" wins over "弹簧". The original name is always shown beside the reading.
 */
const PART_GLOSSARY: [string, string][] = (
  [
    ["压缩弹簧", "compression spring"],
    ["万向接头", "universal joint"],
    ["弹性螺母", "spring nut"],
    ["不沉头", "non-countersunk"],
    ["伸缩管", "telescoping tube"],
    ["防滑垫", "anti-slip pad"],
    ["压线扣", "cable clip"],
    ["可转动", "rotating"],
    ["摄像头", "camera"],
    ["笔记本", "laptop"],
    ["无线充", "wireless charging"],
    ["沉头", "countersunk"],
    ["支架", "bracket"],
    ["挂架", "hanger"],
    ["桌板", "desk panel"],
    ["桌腿", "leg"],
    ["桌脚", "foot"],
    ["桌面", "desktop"],
    ["主体", "main body"],
    ["组件", "assembly"],
    ["部件", "component"],
    ["零件", "part"],
    ["实体", "body"],
    ["侧面", "side"],
    ["顶板", "top plate"],
    ["底板", "base plate"],
    ["底座", "base"],
    ["上盖", "top cover"],
    ["插槽", "slot"],
    ["插条", "insert strip"],
    ["卡扣", "snap clip"],
    ["线扣", "cable clip"],
    ["线槽", "cable tray"],
    ["管道", "pipe"],
    ["铝板", "aluminum panel"],
    ["折弯", "bent"],
    ["塑胶", "plastic"],
    ["硅胶", "silicone"],
    ["橡胶", "rubber"],
    ["毛毡", "felt"],
    ["螺钉", "screw"],
    ["螺丝", "screw"],
    ["螺母", "nut"],
    ["螺栓", "bolt"],
    ["垫圈", "washer"],
    ["垫片", "shim"],
    ["弹簧", "spring"],
    ["弹珠", "detent ball"],
    ["手拧", "thumb"],
    ["锁紧", "locking"],
    ["脚垫", "foot pad"],
    ["堵头", "end cap"],
    ["铰链", "hinge"],
    ["转轴", "pivot"],
    ["转盘", "turntable"],
    ["双头", "double-ended"],
    ["双凹", "double-concave"],
    ["轨道", "rail"],
    ["抽屉", "drawer"],
    ["收纳", "storage"],
    ["托钩", "support hook"],
    ["U型", "U-shaped"],
    ["斜角", "angled"],
    ["手机", "phone"],
    ["手表", "watch"],
    ["耳机", "headset"],
    ["平板", "tablet"],
    ["电源", "power supply"],
    ["充电", "charging"],
    ["内衬", "liner"],
    ["衬套", "sleeve"],
    ["方案", "concept"],
    ["配件", "accessory"],
    ["压板", "clamp plate"],
    ["中心", "center"],
    ["底", "base"],
    ["盖", "cover"],
    ["架", "holder"],
    ["夹", "clip"],
    ["钩", "hook"],
    ["管", "tube"],
    ["杯", "cup"],
    ["左", "left"],
    ["右", "right"],
    ["斜", "bevel"],
    ["改", "revised"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

const CJK_RE = /[㐀-鿿豈-﫿]/;

/**
 * An English reading of a Chinese part name ("桌腿沉头" → "Leg countersunk"), or null when the name has
 * no Chinese in it. Terms the glossary does not know stay as they are.
 */
export function translatePartName(name: string): string | null {
  if (!CJK_RE.test(name)) return null;
  let out = name;
  for (const [term, english] of PART_GLOSSARY) {
    if (out.includes(term)) out = out.split(term).join(` ${english} `);
  }
  out = out
    .replace(/\s+/g, " ")
    // A hyphen the CAD name spaced stays spaced; the glossary's own compounds ("wireless-charger") do not.
    .replace(/\s+-\s*|\s*-\s+/g, " - ")
    .replace(/\s+([)_])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .trim();
  if (!out || out === name) return null;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The label a part shows: the English reading first, the CAD name after it. */
export function partLabel(name: string): { primary: string; secondary: string | null } {
  const clean = name.replace(/\s+/g, " ").trim() || "Unnamed part";
  const english = translatePartName(clean);
  return english ? { primary: english, secondary: clean } : { primary: clean, secondary: null };
}

/* ------------------------------------------------------------------ finishes */

export type FinishGroup = "Metal" | "Coating" | "Plastic" | "Soft" | "Clear";

export type Finish = {
  id: string;
  label: string;
  group: FinishGroup;
  /** sRGB hex, or "cad" to keep each part's own CAD color. */
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenRoughness?: number;
  sheenColor?: string;
  transmission?: number;
  ior?: number;
  /** Metres of glass the light passes through (transmission only). */
  thickness?: number;
  /** Whether the color can be changed (anodizing, paint, and plastic come in any color). */
  tintable: boolean;
};

export const FINISHES: Finish[] = [
  { id: "anodized-silver", label: "Silver anodized aluminum", group: "Metal", color: "#c8cbd0", metalness: 1, roughness: 0.34, tintable: true },
  { id: "anodized-space-gray", label: "Space gray anodized aluminum", group: "Metal", color: "#6b6e74", metalness: 1, roughness: 0.38, tintable: true },
  { id: "anodized-black", label: "Black anodized aluminum", group: "Metal", color: "#2c2d31", metalness: 1, roughness: 0.42, tintable: true },
  { id: "brushed-aluminum", label: "Brushed aluminum", group: "Metal", color: "#d6d8db", metalness: 1, roughness: 0.22, tintable: false },
  { id: "stainless-steel", label: "Stainless steel", group: "Metal", color: "#b4b6b9", metalness: 1, roughness: 0.26, tintable: false },
  { id: "polished-chrome", label: "Polished chrome", group: "Metal", color: "#f2f3f5", metalness: 1, roughness: 0.05, tintable: false },
  { id: "powder-black", label: "Matte black powder coat", group: "Coating", color: "#1e1f22", metalness: 0, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6, tintable: true },
  { id: "powder-white", label: "White powder coat", group: "Coating", color: "#eeece8", metalness: 0, roughness: 0.55, clearcoat: 0.1, clearcoatRoughness: 0.5, tintable: true },
  { id: "satin-black", label: "Satin black plastic", group: "Plastic", color: "#1b1c1f", metalness: 0, roughness: 0.45, tintable: true },
  { id: "satin-white", label: "Satin white plastic", group: "Plastic", color: "#f1f0ed", metalness: 0, roughness: 0.4, tintable: true },
  { id: "cad-satin", label: "CAD color, satin plastic", group: "Plastic", color: "cad", metalness: 0, roughness: 0.42, tintable: true },
  { id: "gloss-plastic", label: "Gloss plastic", group: "Plastic", color: "cad", metalness: 0, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, tintable: true },
  { id: "rubber-black", label: "Black silicone rubber", group: "Soft", color: "#202124", metalness: 0, roughness: 0.85, tintable: true },
  { id: "felt-charcoal", label: "Charcoal felt", group: "Soft", color: "#3b3d42", metalness: 0, roughness: 1, sheen: 1, sheenRoughness: 0.7, sheenColor: "#8a8d94", tintable: true },
  { id: "clear-acrylic", label: "Clear acrylic", group: "Clear", color: "#ffffff", metalness: 0, roughness: 0.02, transmission: 1, ior: 1.49, thickness: 0.004, tintable: false },
  { id: "frosted-acrylic", label: "Frosted acrylic", group: "Clear", color: "#ffffff", metalness: 0, roughness: 0.35, transmission: 1, ior: 1.49, thickness: 0.004, tintable: false },
];

export const FINISH_GROUPS: FinishGroup[] = ["Metal", "Coating", "Plastic", "Soft", "Clear"];

const FINISH_BY_ID = new Map(FINISHES.map((finish) => [finish.id, finish]));

export function finishById(id: string): Finish {
  return FINISH_BY_ID.get(id) ?? FINISH_BY_ID.get("anodized-silver")!;
}

export function isFinishId(id: string): boolean {
  return FINISH_BY_ID.has(id);
}

/** Linear 0–1 RGB, as OpenCascade reports STEP colors. */
export type LinearRgb = [number, number, number];

/** Standard parts are named after their standard: "ISO 4762 - M4 x 10", "DIN 125 - 4", "JIS B 1111 - M3 x 6". */
const FASTENER_STANDARD_RE = /^\s*(ISO|DIN|ANSI|ASME|JIS|BS|CSN|EN|GB(?:\/T)?)\s*[A-Z]?\s*[\d.]+/;
const STEEL_TERMS_RE = /螺钉|螺栓|螺母|弹簧|垫圈|弹珠|手拧螺|锁紧螺/;

/**
 * The finish a part starts with. Names win over colors: fasteners, springs, and washers are steel,
 * felt is felt, pads are rubber. Otherwise the CAD color picks: the default SolidWorks gray reads as
 * bare aluminum, near-black as black plastic, near-white as white powder coat, and any real color
 * stays as a satin plastic in that color.
 */
export function defaultFinishFor(partName: string, cadColor: LinearRgb | null): string {
  const name = partName ?? "";
  // A label or sticker over a screw is not steel, whatever else its name says.
  if (/贴|标签|\b(sticker|label|decal)\b/i.test(name)) return cadColor ? finishForColor(cadColor) : "satin-black";
  if (FASTENER_STANDARD_RE.test(name) || STEEL_TERMS_RE.test(name) || /\b(screw|bolt|nut|washer|spring)\b/i.test(name)) {
    return "stainless-steel";
  }
  if (/毛毡|\bfelt\b/i.test(name)) return "felt-charcoal";
  if (/防滑垫|脚垫|硅胶|橡胶|\b(rubber|silicone|pad)\b/i.test(name)) return "rubber-black";
  if (/亚克力|有机玻璃|\b(acrylic|glass)\b/i.test(name)) return "clear-acrylic";
  if (!cadColor) return "anodized-silver";
  return finishForColor(cadColor);
}

function finishForColor([r, g, b]: LinearRgb): string {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (chroma > 0.08) return "cad-satin";
  if (luminance < 0.12) return "satin-black";
  if (luminance < 0.3) return "anodized-black";
  if (luminance < 0.48) return "anodized-space-gray";
  if (luminance <= 0.85) return "anodized-silver";
  return "powder-white";
}

/** Linear 0–1 → "#rrggbb" in sRGB, for color inputs and swatches. */
export function linearRgbToHex([r, g, b]: LinearRgb): string {
  const toSrgb = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${toSrgb(r)}${toSrgb(g)}${toSrgb(b)}`;
}

/* ------------------------------------------------------------------ studio lighting */

/**
 * A softbox on the studio sphere around the product. Azimuth 0 faces the product from the camera side,
 * 90 is to its right, -90 to its left, 180 behind it. Elevation 90 is straight overhead.
 * Width and height are angular sizes in degrees; intensity is radiance in the HDR environment.
 */
export type Softbox = {
  azimuth: number;
  elevation: number;
  width: number;
  height: number;
  intensity: number;
  kelvin: number;
  round?: boolean;
  /** 0 is a hard edge, 1 fades across the whole box. */
  softness?: number;
};

export type StudioPreset = {
  id: string;
  label: string;
  hint: string;
  /** Surround radiance at the zenith, the horizon, and the nadir (linear RGB). */
  top: LinearRgb;
  horizon: LinearRgb;
  bottom: LinearRgb;
  softboxes: Softbox[];
};

export const STUDIO_PRESETS: StudioPreset[] = [
  {
    id: "softbox",
    label: "Studio softbox",
    hint: "Big overhead diffusion, a key box, and strip lights: metal reads as soft gradients.",
    top: [0.2, 0.2, 0.205],
    horizon: [0.08, 0.08, 0.082],
    bottom: [0.025, 0.025, 0.025],
    softboxes: [
      { azimuth: -38, elevation: 30, width: 64, height: 46, intensity: 3, kelvin: 5600, softness: 0.4 },
      { azimuth: 0, elevation: 72, width: 90, height: 56, intensity: 1.6, kelvin: 5600, softness: 0.5 },
      { azimuth: 68, elevation: 16, width: 24, height: 62, intensity: 1.3, kelvin: 5600, softness: 0.35 },
      { azimuth: 100, elevation: 20, width: 12, height: 56, intensity: 4, kelvin: 6000, softness: 0.2 },
      { azimuth: -100, elevation: 20, width: 12, height: 56, intensity: 3, kelvin: 6000, softness: 0.2 },
    ],
  },
  {
    id: "high-key",
    label: "Bright white",
    hint: "Even, nearly shadowless light for catalog and marketplace images.",
    top: [0.5, 0.5, 0.5],
    horizon: [0.42, 0.42, 0.43],
    bottom: [0.26, 0.26, 0.265],
    softboxes: [
      { azimuth: -28, elevation: 30, width: 70, height: 50, intensity: 1.5, kelvin: 5600, softness: 0.6 },
      { azimuth: 0, elevation: 80, width: 70, height: 70, intensity: 1.2, kelvin: 5600, softness: 0.6 },
    ],
  },
  {
    id: "low-key",
    label: "Dramatic rim",
    hint: "Near-black surround with hard strip lights that trace the edges.",
    top: [0.008, 0.008, 0.009],
    horizon: [0.005, 0.005, 0.006],
    bottom: [0.003, 0.003, 0.003],
    softboxes: [
      { azimuth: 100, elevation: 14, width: 9, height: 66, intensity: 16, kelvin: 6500, softness: 0.15 },
      { azimuth: -100, elevation: 14, width: 9, height: 66, intensity: 16, kelvin: 6500, softness: 0.15 },
      { azimuth: -55, elevation: 48, width: 26, height: 24, intensity: 5, kelvin: 5200, softness: 0.3 },
    ],
  },
  {
    id: "daylight",
    label: "Window daylight",
    hint: "A tall window to one side and cool skylight from above — a lifestyle look.",
    top: [0.32, 0.38, 0.5],
    horizon: [0.42, 0.44, 0.46],
    bottom: [0.12, 0.11, 0.1],
    softboxes: [
      { azimuth: -72, elevation: 22, width: 56, height: 48, intensity: 6.5, kelvin: 5800, softness: 0.25 },
      { azimuth: 35, elevation: 58, width: 60, height: 40, intensity: 0.9, kelvin: 7500, softness: 0.6 },
    ],
  },
];

export function studioPresetById(id: string): StudioPreset {
  return STUDIO_PRESETS.find((preset) => preset.id === id) ?? STUDIO_PRESETS[0]!;
}

/** A blackbody color temperature as linear RGB with the brightest channel at 1 (Tanner Helland's fit). */
export function kelvinToLinearRgb(kelvin: number): LinearRgb {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  const r = t <= 66 ? 1 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lin: LinearRgb = [toLinear(r), toLinear(g), toLinear(b)];
  const peak = Math.max(...lin);
  return [lin[0] / peak, lin[1] / peak, lin[2] / peak];
}

/** Studio strobes are daylight balanced and the camera is white-balanced to them. */
export const STUDIO_WHITE_KELVIN = 5600;

/**
 * A light's color as a camera white-balanced to studio daylight (5600 K) sees it: 5600 K is neutral white,
 * lower temperatures warm, higher ones cool. Brightest channel at 1.
 */
export function lightTint(kelvin: number): LinearRgb {
  const c = kelvinToLinearRgb(kelvin);
  const white = kelvinToLinearRgb(STUDIO_WHITE_KELVIN);
  const balanced: LinearRgb = [c[0] / white[0], c[1] / white[1], c[2] / white[2]];
  const peak = Math.max(...balanced);
  return [balanced[0] / peak, balanced[1] / peak, balanced[2] / peak];
}

/** Unit direction for a softbox position, in three.js axes (+Y up, the camera side is +Z). */
export function studioDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

function smoothFade(distance: number, half: number, edge: number): number {
  if (edge <= 0) return distance <= half ? 1 : 0;
  const t = Math.min(1, Math.max(0, (half - distance) / edge + 0.5));
  return t * t * (3 - 2 * t);
}

/**
 * The studio as an equirectangular HDR (RGBA float, row 0 at the bottom) in three.js's equirect layout:
 * u = atan2(z, x) / 2π + 0.5, v = asin(y) / π + 0.5. Each softbox is a gnomonic rectangle or disc
 * around its direction, so it keeps its shape overhead as well as at the horizon.
 */
export function studioEnvironmentPixels(preset: StudioPreset, width: number, height: number): Float32Array {
  const data = new Float32Array(width * height * 4);
  const boxes = preset.softboxes.map((box) => {
    const c = studioDirection(box.azimuth, box.elevation);
    // A tangent frame around the box center; the world X axis stands in for "right" straight overhead.
    let right: [number, number, number] = [c[2], 0, -c[0]];
    const len = Math.hypot(right[0], right[2]);
    right = len < 1e-6 ? [1, 0, 0] : [right[0] / len, 0, right[2] / len];
    const up: [number, number, number] = [
      c[1] * right[2] - c[2] * right[1],
      c[2] * right[0] - c[0] * right[2],
      c[0] * right[1] - c[1] * right[0],
    ];
    const halfW = Math.tan(((box.width / 2) * Math.PI) / 180);
    const halfH = Math.tan(((box.height / 2) * Math.PI) / 180);
    const softness = box.softness ?? 0.3;
    const tint = lightTint(box.kelvin);
    return {
      c,
      right,
      up,
      halfW,
      halfH,
      edgeW: softness * halfW,
      edgeH: softness * halfH,
      round: !!box.round,
      color: [tint[0] * box.intensity, tint[1] * box.intensity, tint[2] * box.intensity] as LinearRgb,
    };
  });

  for (let j = 0; j < height; j++) {
    const v = (j + 0.5) / height;
    const lat = (v - 0.5) * Math.PI;
    const y = Math.sin(lat);
    const cosLat = Math.cos(lat);
    // Surround: horizon → zenith above, horizon → nadir below, eased so the horizon band is soft.
    const k = Math.pow(Math.abs(y), 0.6);
    const from = preset.horizon;
    const to = y >= 0 ? preset.top : preset.bottom;
    const base: LinearRgb = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2;
      const dx = Math.cos(phi) * cosLat;
      const dz = Math.sin(phi) * cosLat;
      let r = base[0];
      let g = base[1];
      let b = base[2];
      for (const box of boxes) {
        const facing = dx * box.c[0] + y * box.c[1] + dz * box.c[2];
        if (facing <= 0.05) continue;
        const px = (dx * box.right[0] + y * box.right[1] + dz * box.right[2]) / facing;
        const py = (dx * box.up[0] + y * box.up[1] + dz * box.up[2]) / facing;
        let w: number;
        if (box.round) {
          const radius = Math.hypot(px / box.halfW, py / box.halfH);
          w = smoothFade(radius, 1, (box.edgeW / box.halfW) * 2);
        } else {
          w = smoothFade(Math.abs(px), box.halfW, box.edgeW * 2) * smoothFade(Math.abs(py), box.halfH, box.edgeH * 2);
        }
        if (w <= 0) continue;
        r += box.color[0] * w;
        g += box.color[1] * w;
        b += box.color[2] * w;
      }
      const o = (j * width + i) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 1;
    }
  }
  return data;
}

/**
 * The seamless sweep's shape in multiples of the product's bounding radius: floor toward the camera
 * (`front`), a curve of radius `curve`, and a wall `back` behind the product rising to `height`.
 */
export type SweepShape = { width: number; front: number; back: number; curve: number; height: number };

export const SWEEP_SHAPE: SweepShape = { width: 18, front: 9, back: 2.6, curve: 1.8, height: 8 };

/**
 * What a ray from the product (at `probeHeight` radii above the floor) hits first: the sweep's floor,
 * its wall (the curve counts as wall), or nothing, in which case the studio itself is seen.
 */
export function sweepHit(dir: [number, number, number], probeHeight: number, shape: SweepShape = SWEEP_SHAPE): "floor" | "wall" | null {
  const [x, y, z] = dir;
  const halfWidth = shape.width / 2;
  if (y < 0) {
    const t = -probeHeight / y;
    const hx = x * t;
    const hz = z * t;
    if (Math.abs(hx) <= halfWidth && hz <= shape.front) {
      if (hz >= -shape.back + shape.curve) return "floor";
      // Heading down past where the curve starts: the ray meets the curve (or the wall above it) first.
      return "wall";
    }
  }
  if (z < 0) {
    const t = -shape.back / z;
    const hx = x * t;
    const hy = probeHeight + y * t;
    if (Math.abs(hx) <= halfWidth && hy <= shape.height && hy >= -1e-6) return "wall";
  }
  return null;
}

/** Cosine-weighted irradiance from an equirect environment onto a surface facing `normal`. */
export function environmentIrradiance(pixels: Float32Array, width: number, height: number, normal: [number, number, number], stride = 4): LinearRgb {
  const out: LinearRgb = [0, 0, 0];
  const dPhi = (2 * Math.PI * stride) / width;
  const dLat = (Math.PI * stride) / height;
  for (let j = Math.floor(stride / 2); j < height; j += stride) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(lat);
    const cosLat = Math.cos(lat);
    for (let i = Math.floor(stride / 2); i < width; i += stride) {
      const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2;
      const cosTheta = Math.cos(phi) * cosLat * normal[0] + y * normal[1] + Math.sin(phi) * cosLat * normal[2];
      if (cosTheta <= 0) continue;
      const w = cosTheta * cosLat * dPhi * dLat;
      const o = (j * width + i) * 4;
      out[0] += pixels[o]! * w;
      out[1] += pixels[o + 1]! * w;
      out[2] += pixels[o + 2]! * w;
    }
  }
  return out;
}

/**
 * The studio as seen from the product with the sweep in place: directions that hit the sweep show lit
 * paper (albedo × irradiance / π) instead of the studio behind it. The raster preview lights and reflects
 * with this, so metal mirrors the paper the way the path tracer (which traces the real sweep) shows it.
 */
export function bakeSweepEnvironment(
  pixels: Float32Array,
  width: number,
  height: number,
  albedo: LinearRgb,
  probeHeight: number,
  shape: SweepShape = SWEEP_SHAPE,
): Float32Array {
  const floorE = environmentIrradiance(pixels, width, height, [0, 1, 0]);
  const wallE = environmentIrradiance(pixels, width, height, [0, 0, 1]);
  const floor: LinearRgb = [(albedo[0] * floorE[0]) / Math.PI, (albedo[1] * floorE[1]) / Math.PI, (albedo[2] * floorE[2]) / Math.PI];
  const wall: LinearRgb = [(albedo[0] * wallE[0]) / Math.PI, (albedo[1] * wallE[1]) / Math.PI, (albedo[2] * wallE[2]) / Math.PI];
  const out = new Float32Array(pixels);
  for (let j = 0; j < height; j++) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(lat);
    const cosLat = Math.cos(lat);
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2;
      const hit = sweepHit([Math.cos(phi) * cosLat, y, Math.sin(phi) * cosLat], probeHeight, shape);
      if (!hit) continue;
      const color = hit === "floor" ? floor : wall;
      const o = (j * width + i) * 4;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
    }
  }
  return out;
}

/**
 * The studio turned about the vertical axis by `radians`, as three.js's `environmentRotation` (and the
 * path tracer) would turn it: a light at azimuth a moves to a + radians. Used to bake the sweep into an
 * already-turned studio, since the sweep itself must not turn with the lights.
 */
export function rotateEquirect(pixels: Float32Array, width: number, height: number, radians: number): Float32Array {
  const shift = (radians / (2 * Math.PI)) * width;
  if (Math.abs(shift % width) < 1e-9) return pixels;
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < width; i++) {
    const source = i + shift;
    const i0 = Math.floor(source);
    const t = source - i0;
    const a = ((i0 % width) + width) % width;
    const b = (a + 1) % width;
    for (let j = 0; j < height; j++) {
      const o = (j * width + i) * 4;
      const oa = (j * width + a) * 4;
      const ob = (j * width + b) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = pixels[oa + k]! * (1 - t) + pixels[ob + k]! * t;
    }
  }
  return out;
}

/** "#rrggbb" in sRGB → linear 0–1. */
export function hexToLinearRgb(hex: string): LinearRgb {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "ffffff";
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [channel(0), channel(2), channel(4)];
}

/* ------------------------------------------------------------------ backdrop, camera, renders */

export type Backdrop = {
  id: string;
  label: string;
  /** sRGB hex of the seamless sweep, or null for no sweep. */
  color: string | null;
  /** With no sweep: show the studio itself behind the product, or render a transparent PNG. */
  background: "sweep" | "studio" | "transparent";
};

export const BACKDROPS: Backdrop[] = [
  { id: "white", label: "White sweep", color: "#f3f3f1", background: "sweep" },
  { id: "gray", label: "Gray sweep", color: "#bfc1c5", background: "sweep" },
  { id: "charcoal", label: "Charcoal sweep", color: "#2a2b2f", background: "sweep" },
  { id: "indigo", label: "Indigo sweep", color: "#4b48c8", background: "sweep" },
  { id: "studio", label: "No sweep, show the studio", color: null, background: "studio" },
  { id: "transparent", label: "Transparent PNG", color: null, background: "transparent" },
];

export function backdropById(id: string): Backdrop {
  return BACKDROPS.find((backdrop) => backdrop.id === id) ?? BACKDROPS[0]!;
}

/** Full-frame (36 × 24 mm) vertical field of view for a lens. */
export function verticalFovForFocalLength(focalLengthMm: number): number {
  return (2 * Math.atan(12 / Math.max(1, focalLengthMm)) * 180) / Math.PI;
}

export const LENSES = [35, 50, 85, 105] as const;

/**
 * The vertical field of view a render needs so it shows exactly the crop frame drawn over the viewer:
 * the largest box of the render's aspect that fits the viewer. A wider render keeps the viewer's width
 * and loses height; a narrower one keeps the height.
 */
export function cropVerticalFov(viewAspect: number, renderAspect: number, viewVerticalFovDeg: number): number {
  if (!(viewAspect > 0) || !(renderAspect > 0) || renderAspect <= viewAspect) return viewVerticalFovDeg;
  const half = (viewVerticalFovDeg * Math.PI) / 360;
  return (2 * Math.atan(Math.tan(half) * (viewAspect / renderAspect)) * 180) / Math.PI;
}

/** The crop frame as fractions of the viewer: the largest centered box with the render's aspect. */
export function cropFrame(viewAspect: number, renderAspect: number): { width: number; height: number } {
  if (!(viewAspect > 0) || !(renderAspect > 0)) return { width: 1, height: 1 };
  return renderAspect >= viewAspect ? { width: 1, height: viewAspect / renderAspect } : { width: renderAspect / viewAspect, height: 1 };
}

/**
 * How far the camera sits from a bounding sphere so it fills the frame with `margin` room
 * on the tighter axis.
 */
export function frameDistance(radius: number, verticalFovDeg: number, aspect: number, margin = 1.15): number {
  const vfov = (verticalFovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.1, aspect));
  const fov = Math.min(vfov, hfov);
  return (radius * margin) / Math.sin(fov / 2);
}

/**
 * How far from the orbit target the camera must sit, along its view axis, so every point fits the frame
 * with `margin` room. Points are relative to the target in camera axes: x right, y up, z toward the camera.
 * Tighter than a bounding sphere for long, flat products.
 */
export function fitDistance(points: [number, number, number][], verticalFovDeg: number, aspect: number, margin = 1.1): number {
  const tanV = Math.tan((verticalFovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(0.1, Number.isFinite(aspect) ? aspect : 1);
  let distance = 0;
  for (const [x, y, z] of points) {
    distance = Math.max(distance, z + (Math.abs(x) * margin) / tanH, z + (Math.abs(y) * margin) / tanV);
  }
  return distance;
}

export type RenderAspect = { id: string; label: string; ratio: number | null };

export const RENDER_ASPECTS: RenderAspect[] = [
  { id: "view", label: "Match the viewer", ratio: null },
  { id: "1:1", label: "Square 1:1", ratio: 1 },
  { id: "4:5", label: "Portrait 4:5", ratio: 4 / 5 },
  { id: "3:2", label: "Landscape 3:2", ratio: 3 / 2 },
  { id: "16:9", label: "Wide 16:9", ratio: 16 / 9 },
];

export const RENDER_LONG_EDGES = [1280, 1920, 2560, 3840] as const;

export const RENDER_QUALITIES = [
  { id: "draft", label: "Draft", samples: 64 },
  { id: "good", label: "Good", samples: 256 },
  { id: "final", label: "Final", samples: 1024 },
] as const;

/** Pixel size of a render: the long edge as asked, the short edge from the aspect, both even. */
export function renderDimensions(ratio: number, longEdge: number): { width: number; height: number } {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const edge = Math.max(64, Math.round(longEdge));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return safe >= 1 ? { width: even(edge), height: even(edge / safe) } : { width: even(edge * safe), height: even(edge) };
}

/** Split big renders into tiles so one sample never holds the GPU long enough to lose the context. */
export function renderTiles(width: number, height: number): { x: number; y: number } {
  const pixels = width * height;
  if (pixels <= 1280 * 1280) return { x: 1, y: 1 };
  if (pixels <= 2560 * 1600) return { x: 2, y: 2 };
  return { x: 3, y: 3 };
}

export function renderFileName(modelName: string, studioId: string, width: number, height: number): string {
  return `${slugifyModelName(modelName)}-${studioId}-${width}x${height}.png`;
}

/* ------------------------------------------------------------------ library storage */

/** Largest GLB the library stores. An assembly of a few hundred thousand triangles compresses to 1–2 MB. */
export const LAB_MAX_MODEL_BYTES = 40 * 1024 * 1024;

export function labModelPrefix(organizationId: string): string {
  return `org/${organizationId}/lab/cad/`;
}

export function labModelKey(organizationId: string, slug: string): string {
  return `${labModelPrefix(organizationId)}${slug}.glb`;
}

/** The slug in one of this organization's library keys, or null for any other key. */
export function slugFromLabKey(organizationId: string, key: string): string | null {
  const prefix = labModelPrefix(organizationId);
  if (!key.startsWith(prefix) || !key.endsWith(".glb")) return null;
  const slug = key.slice(prefix.length, -".glb".length);
  return isLabModelSlug(slug) ? slug : null;
}

export type LabModelStats = {
  name: string;
  parts: number;
  triangles: number;
  /** Bounding box in millimetres, as modelled (x, y, z). */
  sizeMm: [number, number, number];
  sourceName: string;
  sourceBytes: number;
};

export type LabModelMeta = LabModelStats & { uploadedBy: string; uploadedAt: number };

export type LabModel = LabModelMeta & { slug: string; bytes: number };

const MAX_NAME = 120;

function boundedCount(value: unknown, field: string, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${field} must be a whole number from 0 to ${max}`);
  return n;
}

/** Check what the page sends with an upload. Throws with a sentence the API returns as a 400. */
export function normalizeLabStats(value: unknown): LabModelStats {
  if (!value || typeof value !== "object") throw new Error("meta must be an object");
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  if (!name) throw new Error("name is required");
  const size = raw.sizeMm;
  if (!Array.isArray(size) || size.length !== 3 || !size.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e7)) {
    throw new Error("sizeMm must be three sizes in millimetres");
  }
  const sourceName = typeof raw.sourceName === "string" ? raw.sourceName.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_NAME) : "";
  return {
    name,
    parts: boundedCount(raw.parts, "parts", 1_000_000),
    triangles: boundedCount(raw.triangles, "triangles", 1_000_000_000),
    sizeMm: [round1(size[0] as number), round1(size[1] as number), round1(size[2] as number)],
    sourceName: sourceName || name,
    sourceBytes: boundedCount(raw.sourceBytes ?? 0, "sourceBytes", 2_000_000_000),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** R2 custom metadata is strings only, so the stats travel as one JSON value. */
export function encodeLabMeta(meta: LabModelMeta): Record<string, string> {
  return { lab: JSON.stringify(meta) };
}

export function parseLabMeta(custom: Record<string, string> | undefined, fallbackName: string): LabModelMeta {
  try {
    const parsed = JSON.parse(custom?.lab ?? "") as Partial<LabModelMeta>;
    const stats = normalizeLabStats(parsed);
    return {
      ...stats,
      uploadedBy: typeof parsed.uploadedBy === "string" ? parsed.uploadedBy : "",
      uploadedAt: typeof parsed.uploadedAt === "number" ? parsed.uploadedAt : 0,
    };
  } catch {
    return { name: fallbackName, parts: 0, triangles: 0, sizeMm: [0, 0, 0], sourceName: fallbackName, sourceBytes: 0, uploadedBy: "", uploadedAt: 0 };
  }
}

/** A binary glTF 2.0 file starts with "glTF" and version 2. */
export function isGlb(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2;
}

/** Library order: families together (by prefix, then the rest), then by name with numbers in order. */
export function sortLabModels<T extends { name: string }>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const sa = modelSeries(a.name) ?? "￿";
    const sb = modelSeries(b.name) ?? "￿";
    if (sa !== sb) return sa.localeCompare(sb);
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}
