import type { Context } from "hono";
import { HttpError } from "../http-error";
import type { ProviderType } from "@shared/constants";
import type { z } from "zod";

/**
 * Read and parse a JSON body through a Zod schema, returning typed data.
 * `T` is inferred from the schema's output type.
 */
export async function readJson<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON request body");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.join(".") || "body";
    throw new HttpError(400, `Invalid "${path}": ${issue?.message ?? "invalid value"}`);
  }
  return result.data;
}

export function asProvider(v: unknown): ProviderType {
  if (v === "imap" || v === "gmail" || v === "microsoft" || v === "pop3") return v;
  throw new HttpError(400, "Unsupported provider");
}
