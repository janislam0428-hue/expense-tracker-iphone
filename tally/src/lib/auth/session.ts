import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { cleanEnv } from "@/lib/db-client";
import { ensureDatabaseInitialized } from "@/lib/db-init";
import { equalsPlain, passwordVersion, verifyPassword } from "./password";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from "./token";

/** Local default so `npm run local` works without any setup. Never used in production. */
export const LOCAL_DEFAULT_PASSWORD = "tally";

export function envPassword(): string | undefined {
  const p = cleanEnv(process.env.APP_PASSWORD);
  if (p) return p;
  return process.env.NODE_ENV === "production" ? undefined : LOCAL_DEFAULT_PASSWORD;
}

async function currentPasswordVersion(): Promise<string> {
  await ensureDatabaseInitialized();
  const s = await db.settings.findUnique({ where: { id: 1 }, select: { passwordHash: true } });
  return passwordVersion(s?.passwordHash ?? null, envPassword());
}

export async function checkPassword(candidate: string): Promise<"ok" | "wrong" | "not_configured"> {
  await ensureDatabaseInitialized();
  const s = await db.settings.findUnique({ where: { id: 1 }, select: { passwordHash: true } });
  if (s?.passwordHash) return (await verifyPassword(candidate, s.passwordHash)) ? "ok" : "wrong";
  const env = envPassword();
  if (!env) return "not_configured";
  return equalsPlain(candidate.trim(), env) ? "ok" : "wrong";
}

export async function createSession() {
  const token = await signSession({ pv: await currentPasswordVersion() });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Full check: valid signature, not expired, and issued for the current password. */
export async function isAuthenticated(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await verifySession(token);
  if (!claims) return false;
  return claims.pv === (await currentPasswordVersion());
}

/** Call at the top of every protected page, layout and server action. */
export async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

export async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}
