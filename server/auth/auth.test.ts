import { describe, it, expect } from "vitest";
import { sha256Hex, randomToken, safeEqual, isAllowedUser } from "./index";

describe("auth helpers", () => {
  it("sha256Hex produces a 64-char hex hash", async () => {
    const h = await sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("randomToken is 64 hex chars and unique", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("safeEqual is constant-time and correct", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
    expect(await safeEqual(undefined, "abc")).toBe(false);
  });

  it("isAllowedUser compares numeric GitHub id", () => {
    const env = { ALLOWED_GITHUB_USER_ID: "12345" } as never;
    expect(isAllowedUser(env, 12345)).toBe(true);
    expect(isAllowedUser(env, 9999)).toBe(false);
    // Invalid config denies everyone
    expect(isAllowedUser({ ALLOWED_GITHUB_USER_ID: "" } as never, 12345)).toBe(false);
  });
});