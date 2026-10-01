/** A client key the server remembers so a replay returns the first outcome. Blank means the post is not idempotent. */
export class IdempotencyKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyKeyError";
  }
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The key rule for a receive or pick. A missing or blank value is no key.
 * A present key is trimmed and must be 1–128 letters, digits, dots, colons, underscores, or dashes,
 * so it can be stored and compared without spaces or control characters.
 * The header wins when both the header and the body field are set.
 */
export function idempotencyKeyFrom(header: string | null | undefined, bodyField: unknown): string | null {
  if (bodyField !== undefined && bodyField !== null && typeof bodyField !== "string") {
    throw new IdempotencyKeyError("Idempotency key must be text");
  }
  const raw = header?.trim() ? header : typeof bodyField === "string" ? bodyField : null;
  if (raw == null) return null;
  const key = raw.trim();
  if (!key) return null;
  if (!KEY.test(key)) {
    throw new IdempotencyKeyError("Idempotency key must be 1–128 letters, digits, dots, colons, or dashes");
  }
  return key;
}

/** In progress on the server. A replay of this code should wait and try the same key again. */
export const IDEMPOTENCY_IN_PROGRESS = "IDEMPOTENCY_IN_PROGRESS";
