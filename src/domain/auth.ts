const ITERATIONS = 100_000;
const HASH_ALG = "SHA-256";

export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: HASH_ALG },
    keyMaterial,
    256,
  );
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2:${ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterStr, saltHex, expectedHex] = stored.split(":");
  const iterations = parseInt(iterStr, 10);
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: HASH_ALG },
    keyMaterial,
    256,
  );
  const actualHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return actualHex === expectedHex;
}

export function checkLockout(failedLogins: number, lockedUntil: string | null): boolean {
  if (failedLogins < 10) return false;
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

export function generateSessionId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
