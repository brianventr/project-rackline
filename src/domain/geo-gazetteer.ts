export type GazetteerCountry = {
  code: string;
  name: string;
  aliases: string[];
  lat: number;
  lng: number;
  isoNumeric: string;
};

export type GazetteerRegion = {
  code: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  fips?: string;
};

export type GazetteerCity = {
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
};

export const COUNTRIES: GazetteerCountry[] = [
  { code: "US", name: "United States", aliases: ["usa", "united states", "united states of america", "u.s.", "u.s.a.", "america"], lat: 39.8, lng: -98.6, isoNumeric: "840" },
  { code: "CA", name: "Canada", aliases: ["canada"], lat: 56.1, lng: -106.3, isoNumeric: "124" },
  { code: "GB", name: "United Kingdom", aliases: ["uk", "gb", "united kingdom", "great britain", "england", "britain"], lat: 54.7, lng: -3.4, isoNumeric: "826" },
  { code: "AU", name: "Australia", aliases: ["australia"], lat: -25.3, lng: 133.8, isoNumeric: "036" },
  { code: "DE", name: "Germany", aliases: ["germany", "deutschland"], lat: 51.2, lng: 10.4, isoNumeric: "276" },
  { code: "FR", name: "France", aliases: ["france"], lat: 46.2, lng: 2.2, isoNumeric: "250" },
  { code: "MX", name: "Mexico", aliases: ["mexico", "méxico"], lat: 23.6, lng: -102.6, isoNumeric: "484" },
  { code: "JP", name: "Japan", aliases: ["japan"], lat: 36.2, lng: 138.3, isoNumeric: "392" },
  { code: "NL", name: "Netherlands", aliases: ["netherlands", "holland"], lat: 52.1, lng: 5.3, isoNumeric: "528" },
  { code: "IE", name: "Ireland", aliases: ["ireland"], lat: 53.1, lng: -8.0, isoNumeric: "372" },
];

export const REGIONS: GazetteerRegion[] = [
  { code: "AL", name: "Alabama", country: "US", lat: 32.81, lng: -86.79, fips: "01" },
  { code: "AK", name: "Alaska", country: "US", lat: 64.2, lng: -153.37, fips: "02" },
  { code: "AZ", name: "Arizona", country: "US", lat: 34.05, lng: -111.09, fips: "04" },
  { code: "AR", name: "Arkansas", country: "US", lat: 34.95, lng: -92.38, fips: "05" },
  { code: "CA", name: "California", country: "US", lat: 36.78, lng: -119.42, fips: "06" },
  { code: "CO", name: "Colorado", country: "US", lat: 39.55, lng: -105.78, fips: "08" },
  { code: "CT", name: "Connecticut", country: "US", lat: 41.6, lng: -72.73, fips: "09" },
  { code: "DE", name: "Delaware", country: "US", lat: 38.91, lng: -75.53, fips: "10" },
  { code: "DC", name: "District of Columbia", country: "US", lat: 38.91, lng: -77.04, fips: "11" },
  { code: "FL", name: "Florida", country: "US", lat: 27.66, lng: -81.52, fips: "12" },
  { code: "GA", name: "Georgia", country: "US", lat: 32.16, lng: -82.9, fips: "13" },
  { code: "HI", name: "Hawaii", country: "US", lat: 19.9, lng: -155.58, fips: "15" },
  { code: "ID", name: "Idaho", country: "US", lat: 44.07, lng: -114.74, fips: "16" },
  { code: "IL", name: "Illinois", country: "US", lat: 40.63, lng: -89.4, fips: "17" },
  { code: "IN", name: "Indiana", country: "US", lat: 40.27, lng: -86.13, fips: "18" },
  { code: "IA", name: "Iowa", country: "US", lat: 41.88, lng: -93.1, fips: "19" },
  { code: "KS", name: "Kansas", country: "US", lat: 38.53, lng: -98.32, fips: "20" },
  { code: "KY", name: "Kentucky", country: "US", lat: 37.67, lng: -84.67, fips: "21" },
  { code: "LA", name: "Louisiana", country: "US", lat: 31.17, lng: -91.87, fips: "22" },
  { code: "ME", name: "Maine", country: "US", lat: 45.25, lng: -69.45, fips: "23" },
  { code: "MD", name: "Maryland", country: "US", lat: 39.05, lng: -76.64, fips: "24" },
  { code: "MA", name: "Massachusetts", country: "US", lat: 42.23, lng: -71.53, fips: "25" },
  { code: "MI", name: "Michigan", country: "US", lat: 44.31, lng: -85.6, fips: "26" },
  { code: "MN", name: "Minnesota", country: "US", lat: 46.73, lng: -94.69, fips: "27" },
  { code: "MS", name: "Mississippi", country: "US", lat: 32.74, lng: -89.68, fips: "28" },
  { code: "MO", name: "Missouri", country: "US", lat: 38.46, lng: -92.29, fips: "29" },
  { code: "MT", name: "Montana", country: "US", lat: 46.88, lng: -110.36, fips: "30" },
  { code: "NE", name: "Nebraska", country: "US", lat: 41.49, lng: -99.9, fips: "31" },
  { code: "NV", name: "Nevada", country: "US", lat: 38.8, lng: -116.42, fips: "32" },
  { code: "NH", name: "New Hampshire", country: "US", lat: 43.19, lng: -71.57, fips: "33" },
  { code: "NJ", name: "New Jersey", country: "US", lat: 40.06, lng: -74.41, fips: "34" },
  { code: "NM", name: "New Mexico", country: "US", lat: 34.52, lng: -105.87, fips: "35" },
  { code: "NY", name: "New York", country: "US", lat: 42.17, lng: -74.95, fips: "36" },
  { code: "NC", name: "North Carolina", country: "US", lat: 35.63, lng: -79.39, fips: "37" },
  { code: "ND", name: "North Dakota", country: "US", lat: 47.55, lng: -101.0, fips: "38" },
  { code: "OH", name: "Ohio", country: "US", lat: 40.42, lng: -82.91, fips: "39" },
  { code: "OK", name: "Oklahoma", country: "US", lat: 35.01, lng: -97.09, fips: "40" },
  { code: "OR", name: "Oregon", country: "US", lat: 43.8, lng: -120.55, fips: "41" },
  { code: "PA", name: "Pennsylvania", country: "US", lat: 41.2, lng: -77.19, fips: "42" },
  { code: "RI", name: "Rhode Island", country: "US", lat: 41.68, lng: -71.51, fips: "44" },
  { code: "SC", name: "South Carolina", country: "US", lat: 33.86, lng: -80.95, fips: "45" },
  { code: "SD", name: "South Dakota", country: "US", lat: 44.3, lng: -99.44, fips: "46" },
  { code: "TN", name: "Tennessee", country: "US", lat: 35.52, lng: -86.58, fips: "47" },
  { code: "TX", name: "Texas", country: "US", lat: 31.97, lng: -99.9, fips: "48" },
  { code: "UT", name: "Utah", country: "US", lat: 39.32, lng: -111.09, fips: "49" },
  { code: "VT", name: "Vermont", country: "US", lat: 44.56, lng: -72.58, fips: "50" },
  { code: "VA", name: "Virginia", country: "US", lat: 37.43, lng: -78.66, fips: "51" },
  { code: "WA", name: "Washington", country: "US", lat: 47.4, lng: -121.49, fips: "53" },
  { code: "WV", name: "West Virginia", country: "US", lat: 38.6, lng: -80.45, fips: "54" },
  { code: "WI", name: "Wisconsin", country: "US", lat: 44.27, lng: -89.62, fips: "55" },
  { code: "WY", name: "Wyoming", country: "US", lat: 43.08, lng: -107.29, fips: "56" },
  { code: "AB", name: "Alberta", country: "CA", lat: 53.93, lng: -116.58 },
  { code: "BC", name: "British Columbia", country: "CA", lat: 53.73, lng: -127.65 },
  { code: "MB", name: "Manitoba", country: "CA", lat: 53.76, lng: -98.81 },
  { code: "NB", name: "New Brunswick", country: "CA", lat: 46.57, lng: -66.46 },
  { code: "NL", name: "Newfoundland and Labrador", country: "CA", lat: 53.14, lng: -57.66 },
  { code: "NS", name: "Nova Scotia", country: "CA", lat: 44.68, lng: -63.74 },
  { code: "NT", name: "Northwest Territories", country: "CA", lat: 64.83, lng: -124.85 },
  { code: "NU", name: "Nunavut", country: "CA", lat: 70.3, lng: -83.0 },
  { code: "ON", name: "Ontario", country: "CA", lat: 51.25, lng: -85.32 },
  { code: "PE", name: "Prince Edward Island", country: "CA", lat: 46.51, lng: -63.42 },
  { code: "QC", name: "Quebec", country: "CA", lat: 52.94, lng: -73.55 },
  { code: "SK", name: "Saskatchewan", country: "CA", lat: 52.94, lng: -106.45 },
  { code: "YT", name: "Yukon", country: "CA", lat: 64.28, lng: -135.0 },
  { code: "ENG", name: "England", country: "GB", lat: 52.36, lng: -1.17 },
];

export const CITIES: GazetteerCity[] = [
  { city: "Portland", region: "OR", country: "US", lat: 45.5152, lng: -122.6784 },
  { city: "Portland", region: "ME", country: "US", lat: 43.6591, lng: -70.2568 },
  { city: "Seattle", region: "WA", country: "US", lat: 47.6062, lng: -122.3321 },
  { city: "Vancouver", region: "WA", country: "US", lat: 45.6387, lng: -122.6615 },
  { city: "Spokane", region: "WA", country: "US", lat: 47.6588, lng: -117.426 },
  { city: "Los Angeles", region: "CA", country: "US", lat: 34.0522, lng: -118.2437 },
  { city: "San Francisco", region: "CA", country: "US", lat: 37.7749, lng: -122.4194 },
  { city: "San Diego", region: "CA", country: "US", lat: 32.7157, lng: -117.1611 },
  { city: "San Jose", region: "CA", country: "US", lat: 37.3382, lng: -121.8863 },
  { city: "Sacramento", region: "CA", country: "US", lat: 38.5816, lng: -121.4944 },
  { city: "Oakland", region: "CA", country: "US", lat: 37.8044, lng: -122.2712 },
  { city: "Denver", region: "CO", country: "US", lat: 39.7392, lng: -104.9903 },
  { city: "Boulder", region: "CO", country: "US", lat: 40.015, lng: -105.2705 },
  { city: "Phoenix", region: "AZ", country: "US", lat: 33.4484, lng: -112.074 },
  { city: "Tucson", region: "AZ", country: "US", lat: 32.2226, lng: -110.9747 },
  { city: "Las Vegas", region: "NV", country: "US", lat: 36.1699, lng: -115.1398 },
  { city: "Salt Lake City", region: "UT", country: "US", lat: 40.7608, lng: -111.891 },
  { city: "Boise", region: "ID", country: "US", lat: 43.615, lng: -116.2023 },
  { city: "Austin", region: "TX", country: "US", lat: 30.2672, lng: -97.7431 },
  { city: "Dallas", region: "TX", country: "US", lat: 32.7767, lng: -96.797 },
  { city: "Houston", region: "TX", country: "US", lat: 29.7604, lng: -95.3698 },
  { city: "San Antonio", region: "TX", country: "US", lat: 29.4241, lng: -98.4936 },
  { city: "Chicago", region: "IL", country: "US", lat: 41.8781, lng: -87.6298 },
  { city: "Minneapolis", region: "MN", country: "US", lat: 44.9778, lng: -93.265 },
  { city: "Detroit", region: "MI", country: "US", lat: 42.3314, lng: -83.0458 },
  { city: "Milwaukee", region: "WI", country: "US", lat: 43.0389, lng: -87.9065 },
  { city: "St. Louis", region: "MO", country: "US", lat: 38.627, lng: -90.1994 },
  { city: "Kansas City", region: "MO", country: "US", lat: 39.0997, lng: -94.5786 },
  { city: "New York", region: "NY", country: "US", lat: 40.7128, lng: -74.006 },
  { city: "Brooklyn", region: "NY", country: "US", lat: 40.6782, lng: -73.9442 },
  { city: "Buffalo", region: "NY", country: "US", lat: 42.8864, lng: -78.8784 },
  { city: "Boston", region: "MA", country: "US", lat: 42.3601, lng: -71.0589 },
  { city: "Philadelphia", region: "PA", country: "US", lat: 39.9526, lng: -75.1652 },
  { city: "Pittsburgh", region: "PA", country: "US", lat: 40.4406, lng: -79.9959 },
  { city: "Washington", region: "DC", country: "US", lat: 38.9072, lng: -77.0369 },
  { city: "Baltimore", region: "MD", country: "US", lat: 39.2904, lng: -76.6122 },
  { city: "Miami", region: "FL", country: "US", lat: 25.7617, lng: -80.1918 },
  { city: "Orlando", region: "FL", country: "US", lat: 28.5383, lng: -81.3792 },
  { city: "Tampa", region: "FL", country: "US", lat: 27.9506, lng: -82.4572 },
  { city: "Atlanta", region: "GA", country: "US", lat: 33.749, lng: -84.388 },
  { city: "Nashville", region: "TN", country: "US", lat: 36.1627, lng: -86.7816 },
  { city: "Charlotte", region: "NC", country: "US", lat: 35.2271, lng: -80.8431 },
  { city: "Raleigh", region: "NC", country: "US", lat: 35.7796, lng: -78.6382 },
  { city: "New Orleans", region: "LA", country: "US", lat: 29.9511, lng: -90.0715 },
  { city: "Columbus", region: "OH", country: "US", lat: 39.9612, lng: -82.9988 },
  { city: "Cleveland", region: "OH", country: "US", lat: 41.4993, lng: -81.6944 },
  { city: "Indianapolis", region: "IN", country: "US", lat: 39.7684, lng: -86.1581 },
  { city: "Cincinnati", region: "OH", country: "US", lat: 39.1031, lng: -84.512 },
  { city: "Vancouver", region: "BC", country: "CA", lat: 49.2827, lng: -123.1207 },
  { city: "Toronto", region: "ON", country: "CA", lat: 43.6532, lng: -79.3832 },
  { city: "Montreal", region: "QC", country: "CA", lat: 45.5017, lng: -73.5673 },
  { city: "Calgary", region: "AB", country: "CA", lat: 51.0447, lng: -114.0719 },
  { city: "London", region: "ENG", country: "GB", lat: 51.5074, lng: -0.1278 },
  { city: "Manchester", region: "ENG", country: "GB", lat: 53.4808, lng: -2.2426 },
];

export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ");
}

const countryByCode = new Map(COUNTRIES.map((row) => [row.code, row]));
const countryByAlias = new Map<string, GazetteerCountry>();
for (const row of COUNTRIES) {
  countryByAlias.set(normalizeName(row.code), row);
  countryByAlias.set(normalizeName(row.name), row);
  for (const alias of row.aliases) countryByAlias.set(normalizeName(alias), row);
}

const regionByKey = new Map<string, GazetteerRegion>();
for (const row of REGIONS) {
  regionByKey.set(`${row.country}|${row.code}`, row);
  regionByKey.set(`${row.country}|${normalizeName(row.name)}`, row);
}

const cityByKey = new Map<string, GazetteerCity>();
const citiesByName = new Map<string, GazetteerCity[]>();
for (const row of CITIES) {
  cityByKey.set(`${row.country}|${row.region}|${normalizeName(row.city)}`, row);
  const nameKey = `${row.country}|${normalizeName(row.city)}`;
  const list = citiesByName.get(nameKey) ?? [];
  list.push(row);
  citiesByName.set(nameKey, list);
}

export function lookupCountry(value: string | null | undefined): GazetteerCountry | null {
  if (!value?.trim()) return null;
  return countryByAlias.get(normalizeName(value)) ?? countryByCode.get(value.trim().toUpperCase()) ?? null;
}

export function lookupRegion(country: string, value: string | null | undefined): GazetteerRegion | null {
  if (!value?.trim()) return null;
  const code = value.trim().toUpperCase();
  return regionByKey.get(`${country}|${code}`) ?? regionByKey.get(`${country}|${normalizeName(value)}`) ?? null;
}

export function lookupCity(country: string, city: string, region?: string | null): GazetteerCity | null {
  const name = normalizeName(city);
  if (region) {
    const exact = cityByKey.get(`${country}|${region}|${name}`);
    if (exact) return exact;
  }
  const matches = citiesByName.get(`${country}|${name}`) ?? [];
  if (matches.length === 1) return matches[0]!;
  if (region) {
    return matches.find((row) => row.region === region) ?? null;
  }
  return matches[0] ?? null;
}

export function countryByIsoNumeric(id: string): GazetteerCountry | null {
  return COUNTRIES.find((row) => row.isoNumeric === id.padStart(3, "0")) ?? null;
}

export function regionByFips(fips: string): GazetteerRegion | null {
  const padded = fips.padStart(2, "0");
  return REGIONS.find((row) => row.fips === padded) ?? null;
}
