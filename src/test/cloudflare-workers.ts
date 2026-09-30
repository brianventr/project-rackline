/**
 * Stands in for `cloudflare:workers` under vitest, which runs in Node where that module does not exist.
 * The env is empty, so code that asks it for the sealing key throws; tests pass their own secret.
 */
export const env = {};
