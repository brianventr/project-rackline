export class BrandingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandingError";
  }
}

export const MAX_LOGO_URL_LENGTH = 2048;

/** `#RGB` or `#RRGGBB` (any case) to lowercase `#rrggbb`; blank clears it. */
export function parseBrandColor(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new BrandingError("Brand colour must be text like #1f6feb");
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${[...hex].map((digit) => digit + digit).join("")}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`.toLowerCase();
  throw new BrandingError("Brand colour must be a hex colour like #1f6feb");
}

/**
 * The logo loads in the customer's browser on an https page, so only public https URLs work;
 * an app media path would need a sign-in the customer does not have.
 */
export function parseLogoUrl(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new BrandingError("Logo URL must be text");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_LOGO_URL_LENGTH) throw new BrandingError("Logo URL is too long");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BrandingError("Logo URL must be a full https:// link to an image");
  }
  if (parsed.protocol !== "https:") throw new BrandingError("Logo URL must start with https://");
  if (parsed.username || parsed.password) throw new BrandingError("Logo URL cannot carry a username or password");
  return parsed.toString();
}

const DARK_INK = "#111827";

function relativeLuminance(color: string): number {
  const hex = (parseBrandColor(color) ?? "#000000").slice(1);
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Text colour with the better WCAG contrast on top of the brand colour: white or near-black. */
export function brandInk(color: string): "#ffffff" | typeof DARK_INK {
  const luminance = relativeLuminance(color);
  const onWhite = 1.05 / (luminance + 0.05);
  const onDark = (luminance + 0.05) / (relativeLuminance(DARK_INK) + 0.05);
  return onWhite >= onDark ? "#ffffff" : DARK_INK;
}
