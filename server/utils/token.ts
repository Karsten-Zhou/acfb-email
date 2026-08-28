// Small crypto helpers for the provider OAuth connect flow (state binding).

/** Random 64-char hex token (e.g. OAuth state parameter). */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare (byte xor over UTF-8 encodings). */
export async function safeEqual(a: string | undefined, b: string | undefined): Promise<boolean> {
  if (!a || !b) return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
