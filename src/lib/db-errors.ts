export type ConstraintFailure = {
  kind: "unique" | "foreign_key";
  /** The statement that failed, when drizzle wrapped a single query. Batches throw bare D1 errors, so null. */
  verb: "insert" | "update" | "delete" | null;
  /** Unqualified column names a UNIQUE failure names, e.g. ["organization_id", "sku"]. */
  columns: string[];
};

const MAX_CAUSES = 5;
const DB_TEXT = /\bD1_(?:[A-Z]+_)*(?:ERROR|NOTFOUND)\b|\bSQLITE_[A-Z]+\b|\bconstraint failed\b|^Failed query: |\bno such (?:table|column)\b/;
const RUNTIME_ERRORS = new Set(["TypeError", "ReferenceError", "SyntaxError", "RangeError"]);

/** The error and its causes: drizzle wraps a failed query around the D1 error, and D1 batches throw bare. */
export function causeChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = err;
  while (current != null && chain.length < MAX_CAUSES && !chain.includes(current)) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "";
}

function failedQuery(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const query = (err as Error & { query?: unknown }).query;
  return typeof query === "string" ? query : null;
}

/** Which SQLite constraint a D1 error reports, or null when it is not a unique or foreign key failure. */
export function constraintFailure(err: unknown): ConstraintFailure | null {
  const chain = causeChain(err);
  const query = chain.map(failedQuery).find((value): value is string => value !== null) ?? null;
  const verb = query?.trim().match(/^(insert|update|delete)\b/i)?.[1]?.toLowerCase() as ConstraintFailure["verb"] | undefined;
  for (const text of chain.map(messageOf)) {
    const unique = text.match(/\bUNIQUE constraint failed: ([\w., ]+)/);
    if (unique || /\bUNIQUE constraint failed\b/.test(text)) {
      const columns = (unique?.[1] ?? "")
        .split(",")
        .map((part) => part.trim().split(".").pop() ?? "")
        .filter(Boolean);
      return { kind: "unique", verb: verb ?? null, columns };
    }
    if (/\bFOREIGN KEY constraint failed\b/.test(text)) return { kind: "foreign_key", verb: verb ?? null, columns: [] };
  }
  return null;
}

export function isUniqueViolation(err: unknown): boolean {
  return constraintFailure(err)?.kind === "unique";
}

/** A D1 or drizzle failure anywhere in the cause chain. Its text carries SQL, table names, or bound values. */
export function isDatabaseError(err: unknown): boolean {
  return causeChain(err).some((entry) => failedQuery(entry) !== null || DB_TEXT.test(messageOf(entry)));
}

/** The error's own message when it is fit to show or store for people; D1 text and runtime crashes never are. */
export function publicErrorText(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || RUNTIME_ERRORS.has(err.name) || isDatabaseError(err)) return fallback;
  return err.message.trim() || fallback;
}
