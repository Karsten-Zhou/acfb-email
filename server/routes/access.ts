// GET /api/access — verification status + the current request's Access claims.
import { Hono } from "hono";
import { isAccessVerificationEnabled, type AccessSession } from "../access";

type AccessEnv = {
  Bindings: Env;
  Variables: { accessSession?: AccessSession };
};

export const accessRoutes = new Hono<AccessEnv>();

// GET /api/access
accessRoutes.get("/", (c) => {
  return c.json({
    enabled: isAccessVerificationEnabled(c.env),
    aud: c.env.ACCESS_AUD ?? null,
    session: c.get("accessSession") ?? null,
  });
});
