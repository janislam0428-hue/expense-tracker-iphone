// Password hashing with Node's built in scrypt. No native dependencies, works on Vercel.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;
const LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant time comparison for the APP_PASSWORD environment variable. */
export function equalsPlain(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a.normalize("NFKC")).digest();
  const hb = createHash("sha256").update(b.normalize("NFKC")).digest();
  return timingSafeEqual(ha, hb);
}

/** Short fingerprint of the active password. Changing the password signs out old sessions. */
export function passwordVersion(passwordHash: string | null, envPassword: string | undefined): string {
  const basis = passwordHash ?? `env:${envPassword ?? ""}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 12);
}
