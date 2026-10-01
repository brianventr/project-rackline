/**
 * USPS 3-digit ZIP prefixes for each state and territory. A ZIP matches a state when its
 * prefix falls in one of these inclusive ranges. The first digit is too coarse: 981 is
 * Washington and 970–979 are Oregon, but both start with 9.
 *
 * A few prefixes are shared (967 is Hawaii and American Samoa, 969 is the Pacific
 * territories). A ZIP in a shared prefix is accepted for each of those places.
 */
export const ZIP_PREFIX_RANGES: Record<string, readonly (readonly [number, number])[]> = {
  AA: [[340, 340]],
  AE: [[90, 98]],
  AK: [[995, 999]],
  AL: [[350, 369]],
  AP: [[962, 966]],
  AR: [[716, 729]],
  AS: [[967, 967]],
  AZ: [[850, 865]],
  CA: [[900, 961]],
  CO: [[800, 816]],
  CT: [[60, 69]],
  DC: [[200, 200], [202, 205], [569, 569]],
  DE: [[197, 199]],
  FL: [[320, 349]],
  FM: [[969, 969]],
  GA: [[300, 319], [398, 399]],
  GU: [[969, 969]],
  HI: [[967, 968]],
  IA: [[500, 528]],
  ID: [[832, 838]],
  IL: [[600, 629]],
  IN: [[460, 479]],
  KS: [[660, 679]],
  KY: [[400, 427]],
  LA: [[700, 714]],
  MA: [[10, 27]],
  MD: [[206, 219]],
  ME: [[39, 49]],
  MH: [[969, 969]],
  MI: [[480, 499]],
  MN: [[550, 567]],
  MO: [[630, 658]],
  MP: [[969, 969]],
  MS: [[386, 397]],
  MT: [[590, 599]],
  NC: [[270, 289]],
  ND: [[580, 588]],
  NE: [[680, 693]],
  NH: [[30, 38]],
  NJ: [[70, 89]],
  NM: [[870, 884]],
  NV: [[889, 898]],
  NY: [[5, 5], [100, 149]],
  OH: [[430, 459]],
  OK: [[730, 749]],
  OR: [[970, 979]],
  PA: [[150, 196]],
  PR: [[6, 7], [9, 9]],
  PW: [[969, 969]],
  RI: [[28, 29]],
  SC: [[290, 299]],
  SD: [[570, 577]],
  TN: [[370, 385]],
  TX: [[750, 799], [885, 885]],
  UT: [[840, 847]],
  VA: [[201, 201], [220, 246]],
  VI: [[8, 8]],
  VT: [[50, 59]],
  WA: [[980, 994]],
  WI: [[530, 549]],
  WV: [[247, 268]],
  WY: [[820, 831]],
};

/** The first three digits of a ZIP or ZIP+4, or null when it is not a US ZIP. */
export function usZipPrefix(postal: string): number | null {
  const digits = postal.trim().slice(0, 5);
  if (!/^\d{5}$/.test(digits)) return null;
  return Number(digits.slice(0, 3));
}

/** Whether this ZIP's 3-digit prefix is one the state actually uses. */
export function usZipPrefixInState(postal: string, stateCode: string): boolean {
  const prefix = usZipPrefix(postal);
  if (prefix == null) return false;
  const ranges = ZIP_PREFIX_RANGES[stateCode.trim().toUpperCase()];
  if (!ranges) return false;
  return ranges.some(([start, end]) => prefix >= start && prefix <= end);
}
