import {
  lookupCity,
  lookupCountry,
  lookupRegion,
  type GazetteerCity,
} from "./geo-gazetteer";

export type GeoPlace = {
  city: string | null;
  region: string | null;
  country: string;
  lat: number;
  lng: number;
};

export type AddressParts = {
  street?: string;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
};

export type DestColumns = {
  shipToCity: string | null;
  shipToRegion: string | null;
  shipToCountry: string | null;
  shipToLat: number | null;
  shipToLng: number | null;
};

export type OriginColumns = {
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

const US_ZIP = /\b(\d{5})(?:-\d{4})?\b/;
const CITY_STATE_ZIP = /^(.+?),\s*([A-Za-z]{2}|[A-Za-z][A-Za-z .]+?)(?:\s+(\d{5}(?:-\d{4})?))?$/;
const CITY_PROVINCE_POSTAL = /^(.+?),\s*([A-Za-z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)$/i;
const CITY_COUNTRY = /^(.+?),\s*([A-Za-z][A-Za-z .]+)$/;

export function parseAddressText(text: string): AddressParts {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return {};

  let country: string | undefined;
  let locationLine = lines[lines.length - 1]!;
  const lastCountry = lookupCountry(locationLine);
  if (lastCountry && lines.length > 1) {
    country = lastCountry.code;
    locationLine = lines[lines.length - 2]!;
  }

  const ca = locationLine.match(CITY_PROVINCE_POSTAL);
  if (ca) {
    return {
      street: streetFrom(lines, country ? 2 : 1),
      city: ca[1]!.trim(),
      region: ca[2]!.toUpperCase(),
      postal: ca[3]!.toUpperCase().replace(/\s+/, " "),
      country: country ?? "CA",
    };
  }

  const us = locationLine.match(CITY_STATE_ZIP);
  if (us) {
    const regionRaw = us[2]!.trim();
    const region = regionRaw.length === 2 ? regionRaw.toUpperCase() : regionRaw;
    const inferred = country ?? (lookupCountry(regionRaw) ? undefined : "US");
    if (lookupCountry(regionRaw) && !us[3]) {
      return {
        street: streetFrom(lines, country ? 2 : 1),
        city: us[1]!.trim(),
        country: lookupCountry(regionRaw)?.code ?? inferred,
      };
    }
    return {
      street: streetFrom(lines, country ? 2 : 1),
      city: us[1]!.trim(),
      region,
      postal: us[3],
      country: inferred ?? country,
    };
  }

  const named = locationLine.match(CITY_COUNTRY);
  if (named) {
    const maybeCountry = lookupCountry(named[2]);
    if (maybeCountry) {
      return {
        street: streetFrom(lines, country ? 2 : 1),
        city: named[1]!.trim(),
        country: maybeCountry.code,
      };
    }
  }

  const zip = text.match(US_ZIP);
  return {
    street: lines[0],
    city: lines.length > 1 ? locationLine : undefined,
    postal: zip?.[1],
    country,
  };
}

function streetFrom(lines: string[], dropLast: number): string | undefined {
  const kept = lines.slice(0, Math.max(0, lines.length - dropLast));
  return kept.length ? kept.join("\n") : undefined;
}

export function formatShipToAddress(parts: {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postal?: string | null;
  country?: string | null;
}): string | null {
  const cityLine = [parts.city, [parts.region, parts.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const lines = [parts.address1?.trim(), parts.address2?.trim(), cityLine || null, parts.country?.trim()].filter(
    (line): line is string => Boolean(line),
  );
  return lines.length ? lines.join("\n") : null;
}

export function resolvePlace(parts: AddressParts): GeoPlace | null {
  const countryRow = lookupCountry(parts.country ?? (parts.region && lookupRegion("US", parts.region) ? "US" : undefined));
  const country = countryRow?.code ?? (parts.region && lookupRegion("US", parts.region) ? "US" : null);
  if (!country) {
    if (parts.city) {
      const usCity = lookupCity("US", parts.city, undefined);
      if (usCity) return placeFromCity(usCity);
    }
    return null;
  }

  const regionRow = lookupRegion(country, parts.region);
  const region = regionRow?.code ?? (parts.region?.trim().toUpperCase() || null);

  if (parts.city) {
    const city = lookupCity(country, parts.city, region);
    if (city) return placeFromCity(city);
  }

  if (regionRow) {
    return {
      city: parts.city?.trim() || null,
      region: regionRow.code,
      country,
      lat: regionRow.lat,
      lng: regionRow.lng,
    };
  }

  if (countryRow) {
    return {
      city: parts.city?.trim() || null,
      region,
      country,
      lat: countryRow.lat,
      lng: countryRow.lng,
    };
  }

  return null;
}

function placeFromCity(city: GazetteerCity): GeoPlace {
  return {
    city: city.city,
    region: city.region,
    country: city.country,
    lat: city.lat,
    lng: city.lng,
  };
}

export function resolveFromText(text: string | null | undefined): GeoPlace | null {
  if (!text?.trim()) return null;
  return resolvePlace(parseAddressText(text));
}

export function destColumns(place: GeoPlace | null): DestColumns {
  return {
    shipToCity: place?.city ?? null,
    shipToRegion: place?.region ?? null,
    shipToCountry: place?.country ?? null,
    shipToLat: place?.lat ?? null,
    shipToLng: place?.lng ?? null,
  };
}

export function originColumns(place: GeoPlace | null): OriginColumns {
  return {
    city: place?.city ?? null,
    region: place?.region ?? null,
    country: place?.country ?? null,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
  };
}

export function destPatchFromAddress(address: string | null | undefined): DestColumns & { shipToAddress: string | null } {
  const shipToAddress = address?.trim() || null;
  return { shipToAddress, ...destColumns(resolveFromText(shipToAddress)) };
}

export function resolveOrigin(input: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
}): GeoPlace | null {
  if (input.lat != null && input.lng != null && Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    const country = lookupCountry(input.country)?.code ?? input.country ?? "US";
    return {
      city: input.city ?? null,
      region: lookupRegion(country, input.region)?.code ?? input.region ?? null,
      country,
      lat: input.lat,
      lng: input.lng,
    };
  }
  return resolvePlace({
    city: input.city ?? undefined,
    region: input.region ?? undefined,
    country: input.country ?? undefined,
  });
}

export function resolveOrderDest(input: {
  shipToAddress?: string | null;
  shipToCity?: string | null;
  shipToRegion?: string | null;
  shipToCountry?: string | null;
  shipToLat?: number | null;
  shipToLng?: number | null;
}): GeoPlace | null {
  if (input.shipToLat != null && input.shipToLng != null && Number.isFinite(input.shipToLat) && Number.isFinite(input.shipToLng)) {
    const country = lookupCountry(input.shipToCountry)?.code ?? input.shipToCountry;
    if (country) {
      return {
        city: input.shipToCity ?? null,
        region: input.shipToRegion ?? null,
        country,
        lat: input.shipToLat,
        lng: input.shipToLng,
      };
    }
  }
  if (input.shipToCity || input.shipToRegion || input.shipToCountry) {
    const fromCols = resolvePlace({
      city: input.shipToCity ?? undefined,
      region: input.shipToRegion ?? undefined,
      country: input.shipToCountry ?? undefined,
    });
    if (fromCols) return fromCols;
  }
  return resolveFromText(input.shipToAddress);
}
