import { describe, expect, it } from "vitest";
import type { JWTPayload } from "jose";
import { isAccessVerificationEnabled, mapAccessClaims } from "./access";

/** Cast a partial set of the optional ACCESS secrets to the full Env type. */
function env(over: { ACCESS_JWKS?: string; ACCESS_AUD?: string }) {
  return over as unknown as Env;
}

const JWKS_URL = "https://example.cloudflareaccess.com/cdn-cgi/access/certs";

describe("isAccessVerificationEnabled", () => {
  it("is disabled when either secret is missing", () => {
    expect(isAccessVerificationEnabled(env({}))).toBe(false);
    expect(isAccessVerificationEnabled(env({ ACCESS_JWKS: JWKS_URL }))).toBe(false);
    expect(isAccessVerificationEnabled(env({ ACCESS_AUD: "aud-tag" }))).toBe(false);
  });

  it("is enabled when both secrets are set", () => {
    expect(isAccessVerificationEnabled(env({ ACCESS_JWKS: JWKS_URL, ACCESS_AUD: "a" }))).toBe(true);
  });
});

describe("mapAccessClaims", () => {
  it("maps present claims", () => {
    const p: JWTPayload = {
      email: "me@example.com",
      groups: ["everyone", "admins"],
      geo: "US",
      ip: "1.2.3.4",
      exp: 1_700_000_000,
      aud: "aud-tag",
      iss: "https://t.cloudflareaccess.com",
    };
    expect(mapAccessClaims(p)).toEqual({
      email: "me@example.com",
      name: undefined,
      groups: ["everyone", "admins"],
      geo: "US",
      ip: "1.2.3.4",
      aud: "aud-tag",
      iss: "https://t.cloudflareaccess.com",
      exp: 1_700_000_000,
    });
  });

  it("leaves missing claims undefined", () => {
    const c = mapAccessClaims({});
    expect(c.email).toBeUndefined();
    expect(c.groups).toBeUndefined();
    expect(c.exp).toBeUndefined();
  });

  it("reads the first element when aud is an array", () => {
    const p: JWTPayload = { aud: ["first", "second"] };
    expect(mapAccessClaims(p).aud).toBe("first");
  });

  it("drops non-string group members", () => {
    const p: JWTPayload = { groups: ["ok", 42] };
    expect(mapAccessClaims(p).groups).toEqual(["ok"]);
  });
});
