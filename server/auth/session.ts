// Convenience helper to get the authenticated user from a Hono context.
import type { Context } from "hono";
import { HttpError } from "../http-error";
import type { Env } from "../env";
import type { SessionUser } from "./index";

export function currentUser(c: Context<{ Bindings: Env }>): SessionUser {
  const user = (c as Context<{ Bindings: Env }> & { user?: SessionUser }).user;
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}