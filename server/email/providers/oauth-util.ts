// Shared OAuth/JSON helpers for REST providers (Gmail, Graph).
import type { OAuthToken } from "../../oauth/client";

export type { OAuthToken };

/** Authenticated GET (includes a human-readable error text when non-2xx). */
export async function providerGet(
  url: string,
  accessToken: string,
): Promise<{ status: number; json: unknown; errorText?: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  let errorText: string | undefined;
  if (!res.ok) {
    const detail =
      (json &&
        typeof json === "object" &&
        "error" in json &&
        (json as { error?: { message?: string } }).error?.message) ||
      (json &&
        typeof json === "object" &&
        "errorDescription" in json &&
        (json as { errorDescription?: string }).errorDescription) ||
      "";
    errorText = `${res.status}${detail ? ` — ${detail}` : ""}`;
  }
  return { status: res.status, json, errorText };
}

/** Authenticated POST (JSON body; includes error detail when non-2xx). */
export async function providerJson(
  url: string,
  accessToken: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<{ status: number; json: unknown; errorText?: string }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  let errorText: string | undefined;
  if (!res.ok) {
    const errObj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    const detail =
      (errObj && typeof errObj.error === "object" && errObj.error !== null
        ? (errObj.error as { message?: string }).message
        : undefined) ||
      (errObj && typeof errObj.errorDescription === "string"
        ? errObj.errorDescription
        : undefined) ||
      "";
    errorText = `${res.status}${detail ? ` — ${detail}` : ""}`;
  }
  return { status: res.status, json, errorText };
}

/** Authenticated PATCH (JSON body). */
export async function providerJsonPatch(
  url: string,
  accessToken: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  return providerJson(url, accessToken, body, "PATCH");
}

/** Encode bytes to base64url. */
export function base64url(input: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < input.length; i++) bin += String.fromCharCode(input[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode base64url to bytes (or null on failure). */
export function b64urlToBytes(input: string | undefined | null): Uint8Array | null {
  if (!input) return null;
  try {
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
