"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { checkPassword, clientKey, createSession } from "@/lib/auth/session";
import { rateLimit, resetRateLimit } from "@/lib/auth/rate-limit";

export type LoginState = { error?: string } | undefined;

const schema = z.object({
  password: z.string().min(1, "Enter your password").max(200),
  next: z.string().optional(),
});

function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/";
  return next;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ password: formData.get("password"), next: formData.get("next") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter your password" };

  const key = `login:${await clientKey()}`;
  const limit = rateLimit(key, 8, 15 * 60_000);
  if (!limit.ok) {
    return { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.` };
  }

  const result = await checkPassword(parsed.data.password);
  if (result === "not_configured") {
    return { error: "No password is set. Add APP_PASSWORD to the environment variables and redeploy." };
  }
  if (result === "wrong") return { error: "That password is not right." };

  resetRateLimit(key);
  await createSession();
  redirect(safeNext(parsed.data.next));
}
