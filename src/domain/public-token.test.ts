import { describe, expect, it } from "vitest";
import {
  PUBLIC_TOKEN_BYTES,
  encodePublicToken,
  isPublicToken,
  newPublicToken,
  publicLink,
  returnLabelPagePath,
  trackingPagePath,
} from "./public-token";

describe("public tokens", () => {
  it("encodes 128 bits as 22 base64url characters", () => {
    expect(PUBLIC_TOKEN_BYTES).toBe(16);
    expect(encodePublicToken(new Uint8Array(16))).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(encodePublicToken(new Uint8Array(16).fill(255))).toBe("_____________________w");
    const mixed = encodePublicToken(Uint8Array.from([0xfb, 0xff, 0xbf, ...new Array(13).fill(0)]));
    expect(mixed).not.toMatch(/[+/=]/);
    expect(mixed).toHaveLength(22);
  });

  it("mints a fresh valid token each time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newPublicToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(isPublicToken(token)).toBe(true);
  });

  it("rejects anything that is not a token", () => {
    expect(isPublicToken("")).toBe(false);
    expect(isPublicToken(null)).toBe(false);
    expect(isPublicToken("short")).toBe(false);
    expect(isPublicToken("AAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(isPublicToken("AAAAAAAAAAAAAAAAAAAA+A")).toBe(false);
    expect(isPublicToken("../../../etc/passwd....")).toBe(false);
  });

  it("builds the public paths and links", () => {
    expect(trackingPagePath("abc")).toBe("/t/abc");
    expect(returnLabelPagePath("abc")).toBe("/r/abc");
    expect(publicLink("https://rackline.example/", "/t/abc")).toBe("https://rackline.example/t/abc");
  });
});
