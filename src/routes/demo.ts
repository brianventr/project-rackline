import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { originFrom } from "../lib/types";
import { createAuth } from "../lib/auth";
import { DEMO_EMAIL, DEMO_PASSWORD, demoUserExists, seedNorthwind } from "../db/seed";

export const demoRoute = new Hono<AppEnv>();

demoRoute.post("/demo/seed", async (c) => {
  const db = c.get("db");
  if (await demoUserExists(db)) {
    return c.json({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      already: true,
    });
  }

  const origin = originFrom(c.req.url);
  const auth = createAuth(db, c.env, origin);
  const result = await auth.api.signUpEmail({
    body: {
      name: "Avery Maker",
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    },
  });

  const userId = result.user?.id;
  if (!userId) {
    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO_EMAIL)).limit(1);
    if (!user) {
      return c.json({ error: "Could not create demo user" }, 500);
    }
    await seedNorthwind(db, user.id);
  } else {
    await seedNorthwind(db, userId);
  }

  return c.json({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    already: false,
  });
});
