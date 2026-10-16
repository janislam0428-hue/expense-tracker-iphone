// Signed session tokens (HS256 JWT). Used by the proxy for a fast check and by
// the data access layer for the full check. No database access here.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "tally_session";
export const SESSION_DAYS = 30;

const DEV_SECRET = "tally-local-development-secret-change-me-0123456789";

function secretKey(): Uint8Array {
  const raw = (process.env.SESSION_SECRET ?? "").trim().replace(/^["']+|["']+$/g, "");
  if (raw.length >= 32) {
    return new TextEncoder().encode(raw);
  }
  // Fallback if SESSION_SECRET is shorter than 32 chars or omitted:
  // pad deterministically from SESSION_SECRET + APP_PASSWORD + DATABASE_AUTH_TOKEN so it never crashes.
  const fallback = `${raw}|${process.env.APP_PASSWORD ?? ""}|${process.env.DATABASE_AUTH_TOKEN ?? ""}|${DEV_SECRET}`;
  return new TextEncoder().encode(fallback.padEnd(64, "0"));
}

export type SessionClaims = { pv: string };

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.sub !== "owner" || typeof payload.pv !== "string") return null;
    return { pv: payload.pv };
  } catch {
    return null;
  }
}
