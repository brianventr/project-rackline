import { env } from "cloudflare:workers";
import { channelSecret } from "./secret-box";

/**
 * The sealing key, the same one `channelSecret(c.env)` returns, for code with no request env in reach:
 * connection loaders shared across routes, and the Shopify push that runs after every stock post.
 */
export function credentialSecret(): string {
  return channelSecret(env);
}
