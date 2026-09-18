export function newId(): string {
  return crypto.randomUUID();
}

export function docNumber(prefix: string): string {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${prefix}-${token}`;
}
