"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, createSession, requireAuth } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { loadDemoData, removeDemoData } from "@/lib/demo/apply";
import { toMinor } from "@/lib/money";
import { CURRENCIES } from "./options";

export type FormState = { ok?: string; error?: string } | undefined;

const amount = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, "Use a plain number, like 500 or 2000")
  .transform((v) => toMinor(v));

const generalSchema = z.object({
  currency: z.enum(CURRENCIES),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  weekStart: z.enum(["0", "1"]).transform(Number),
  reviewThreshold: amount,
  alertThreshold: amount,
});

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAuth();
  const parsed = generalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the values and try again" };
  const d = parsed.data;

  // Per category alert overrides arrive as cat_<id>. Blank means "use the default".
  const overrides: Array<{ id: string; value: number | null }> = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("cat_")) continue;
    const v = String(raw).trim();
    if (v === "") overrides.push({ id: key.slice(4), value: null });
    else {
      const p = amount.safeParse(v);
      if (!p.success) return { error: "Category alert amounts must be plain numbers, or blank for the default" };
      overrides.push({ id: key.slice(4), value: p.data });
    }
  }

  await db.$transaction([
    db.settings.update({
      where: { id: 1 },
      data: {
        currency: d.currency,
        timezone: d.timezone,
        weekStart: d.weekStart,
        reviewThresholdMinor: d.reviewThreshold,
        alertThresholdMinor: d.alertThreshold,
      },
    }),
    ...overrides.map((o) => db.category.update({ where: { id: o.id }, data: { monthlyAlertMinor: o.value } })),
  ]);
  revalidatePath("/", "layout");
  return { ok: "Settings saved" };
}

export async function setDemoData(enabled: boolean): Promise<FormState> {
  await requireAuth();
  if (enabled) {
    const r = await loadDemoData(db);
    revalidatePath("/", "layout");
    return { ok: `Demo data loaded: ${r.added.toLocaleString("en-HK")} transactions` };
  }
  const removed = await removeDemoData(db);
  await db.settings.update({ where: { id: 1 }, data: { demoEnabled: false } });
  revalidatePath("/", "layout");
  return { ok: `Demo data removed (${removed.toLocaleString("en-HK")} transactions). Your own data is untouched.` };
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "Use at least 8 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "The new passwords don't match", path: ["confirm"] });

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAuth();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if ((await checkPassword(parsed.data.current)) !== "ok") return { error: "Your current password is not right" };
  await db.settings.update({ where: { id: 1 }, data: { passwordHash: await hashPassword(parsed.data.next) } });
  // Re-issue this device's session for the new password. Other devices are signed out.
  await createSession();
  return { ok: "Password changed. Other devices have been signed out." };
}

export async function generateApiToken(): Promise<{ token?: string; error?: string }> {
  await requireAuth();
  try {
    const rawToken = "tally_sec_" + randomBytes(24).toString("hex");
    const hash = createHash("sha256").update(rawToken).digest("hex");
    await db.settings.update({
      where: { id: 1 },
      data: { apiTokenHash: hash },
    });
    revalidatePath("/", "layout");
    return { token: rawToken };
  } catch (err) {
    console.error("Token generation error:", err);
    return { error: "Could not generate API token" };
  }
}
