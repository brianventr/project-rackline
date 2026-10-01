import type { Context } from "hono";
import type { AppEnv } from "./types";
import { forbidden } from "./http";
import type { CapacityOverride } from "../db/capacity";

/** `overrideCapacity: true` lets an owner fill a bay past its limit. Anyone else who sends it is refused. */
export function capacityOverride(c: Context<AppEnv>, flag: unknown): CapacityOverride | undefined {
  if (flag !== true) return undefined;
  if (c.get("role") !== "owner") forbidden("Only an owner can override a bay's capacity");
  const user = c.get("user")!;
  return { userId: user.id, email: user.email, name: user.name, method: c.req.method, path: new URL(c.req.url).pathname };
}
