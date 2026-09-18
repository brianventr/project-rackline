export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message = "Not found"): never {
  throw new HttpError(404, message);
}

export function forbidden(message = "Forbidden"): never {
  throw new HttpError(403, message);
}

export function conflict(message: string): never {
  throw new HttpError(409, message);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    badRequest(`${field} is required`);
  }
  return value.trim();
}

export function requireInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) {
    badRequest(`${field} must be an integer`);
  }
  return n;
}

export function optionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireInt(value, field);
}

export function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
