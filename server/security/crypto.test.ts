import { describe, it, expect } from "vitest";
import { encryptCredential, decryptCredential } from "./crypto";

const KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

describe("credential encryption (AES-GCM)", () => {
  it("round-trips a credential", async () => {
    const plain = JSON.stringify({ username: "user@example.com", password: "secret!" });
    const blob = await encryptCredential(plain, KEY);
    expect(blob.startsWith("v1:")).toBe(true);
    const decrypted = await decryptCredential(blob, KEY);
    expect(decrypted).toBe(plain);
  });

  it("produces different blobs for same plaintext (random IV)", async () => {
    const a = await encryptCredential("same", KEY);
    const b = await encryptCredential("same", KEY);
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with a wrong key", async () => {
    const blob = await encryptCredential("hello", KEY);
    const wrong = "f".repeat(64);
    await expect(decryptCredential(blob, wrong)).rejects.toThrow();
  });

  it("rejects malformed key", async () => {
    await expect(encryptCredential("x", "not-hex")).rejects.toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
  });
});