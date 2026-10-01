import { env } from "cloudflare:workers";
import { channelSecret } from "./secret-box";

/**
 * The sealing key, the same one `channelSecret(c.env, origin)` returns, for code with no request env
 * in reach: connection loaders shared across routes, and the Shopify push that runs after every stock
 * post. Pass the request origin when `BETTER_AUTH_URL` may be unset so localhost agrees with sign-in.
 */
export function credentialSecret(origin?: string): string {
  return channelSecret(env, origin);
}
