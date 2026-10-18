"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, createSession, requireAuth } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { loadDemoData, removeDemoData } from "@/lib/demo/apply";
import { toMinor } from "@/lib/money";
import { formatInZone, monthPeriod } from "@/lib/time";
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
  thresholdComment: z.string().optional(),
});

function resolveThresholdComment(
  rawComment: string | undefined | null,
  fallbackComment: string | undefined | null,
  source: "suggestion" | "manual",
): string {
  const c1 = rawComment?.trim();
  if (c1) return c1;
  const c2 = fallbackComment?.trim();
  if (c2) return c2;
  return source === "suggestion" ? "according to suggestion" : "threshold testing and adjustment";
}

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAuth();
  const parsed = generalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the values and try again" };
  const d = parsed.data;

  const existingSettings = await db.settings.findUnique({ where: { id: 1 } });
  const existingCategories = await db.category.findMany({ where: { parentId: null, archived: false } });
  const existingCatMap = new Map(existingCategories.map((c) => [c.id, c]));

  const now = new Date();
  const currentMonthStart = monthPeriod(now, d.timezone).start;
  const currentMonthKey = formatInZone(currentMonthStart, "yyyy-MM", d.timezone);

  // Per category alert overrides arrive as cat_<id>. Blank means "use the default".
  const overrides: Array<{
    id: string;
    value: number | null;
    comment: string;
    source: "suggestion" | "manual";
  }> = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("cat_")) continue;
    const catId = key.slice(4);
    const v = String(raw).trim();
    const rawCatComment = String(formData.get(`comment_${catId}`) ?? "").trim();
    const rawCatSource = String(formData.get(`source_${catId}`) ?? "").trim();
    const source: "suggestion" | "manual" =
      rawCatSource === "suggestion" || rawCatComment.toLowerCase() === "according to suggestion"
        ? "suggestion"
        : "manual";
    const comment = resolveThresholdComment(rawCatComment, d.thresholdComment, source);

    if (v === "") {
      overrides.push({ id: catId, value: null, comment, source });
    } else {
      const p = amount.safeParse(v);
      if (!p.success) return { error: "Category alert amounts must be plain numbers, or blank for the default" };
      overrides.push({ id: catId, value: p.data, comment, source });
    }
  }

  let changedCount = 0;

  await db.$transaction(async (tx) => {
    await tx.settings.update({
      where: { id: 1 },
      data: {
        currency: d.currency,
        timezone: d.timezone,
        weekStart: d.weekStart,
        reviewThresholdMinor: d.reviewThreshold,
        alertThresholdMinor: d.alertThreshold,
      },
    });

    // Log global default threshold change if modified
    const prevGlobalAlert = existingSettings?.alertThresholdMinor ?? 200000;
    if (prevGlobalAlert !== d.alertThreshold) {
      changedCount++;
      const globalComment = resolveThresholdComment(d.thresholdComment, null, "manual");
      await tx.alertRule.create({
        data: {
          scope: "threshold_log",
          categoryId: null,
          strategy: currentMonthKey,
          enabled: false,
          params: JSON.stringify({
            monthKey: currentMonthKey,
            categoryId: null,
            categoryName: "Default Monthly Alert",
            previousMinor: prevGlobalAlert,
            amountMinor: d.alertThreshold,
            comment: globalComment,
            source: "manual",
            changedAt: now.toISOString(),
          }),
        },
      });
    }

    for (const o of overrides) {
      const prevCat = existingCatMap.get(o.id);
      if (!prevCat) continue;

      const prevEffective = prevCat.monthlyAlertMinor ?? prevGlobalAlert;
      const nextEffective = o.value ?? d.alertThreshold;
      const explicitCatComment = String(formData.get(`comment_${o.id}`) ?? "").trim();
      const didChange = prevCat.monthlyAlertMinor !== o.value || prevEffective !== nextEffective;

      await tx.category.update({
        where: { id: o.id },
        data: { monthlyAlertMinor: o.value },
      });

      // Always keep the current month's Budget snapshot aligned with the latest threshold in this month
      await tx.budget.upsert({
        where: { categoryId_period: { categoryId: o.id, period: currentMonthKey } },
        create: { categoryId: o.id, period: currentMonthKey, amountMinor: nextEffective },
        update: { amountMinor: nextEffective },
      });

      if (didChange || explicitCatComment.length > 0) {
        changedCount++;
        await tx.alertRule.create({
          data: {
            scope: "threshold_log",
            categoryId: o.id,
            strategy: currentMonthKey,
            enabled: false,
            params: JSON.stringify({
              monthKey: currentMonthKey,
              categoryId: o.id,
              categoryName: prevCat.name,
              previousMinor: prevEffective,
              amountMinor: nextEffective,
              comment: o.comment,
              source: o.source,
              changedAt: now.toISOString(),
            }),
          },
        });
      }
    }
  });

  revalidatePath("/", "layout");
  return {
    ok:
      changedCount > 0
        ? `Settings saved & documented ${changedCount} threshold update${changedCount === 1 ? "" : "s"} for ${currentMonthKey}`
        : "Settings saved",
  };
}

export async function updateCategoryThresholdQuick(
  categoryId: string,
  amountMinor: number,
  options?: { comment?: string; source?: "suggestion" | "manual"; monthKey?: string },
): Promise<{ ok?: string; error?: string }> {
  await requireAuth();
  try {
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const zone = settings?.timezone ?? "Asia/Hong_Kong";
    const now = new Date();
    const currentMonthKey =
      options?.monthKey && /^\d{4}-\d{2}$/.test(options.monthKey)
        ? options.monthKey
        : formatInZone(monthPeriod(now, zone).start, "yyyy-MM", zone);

    const existingCat = await db.category.findUnique({ where: { id: categoryId } });
    if (!existingCat) return { error: "Category not found" };

    const prevEffective = existingCat.monthlyAlertMinor ?? settings?.alertThresholdMinor ?? 200000;
    const source: "suggestion" | "manual" = options?.source ?? "suggestion";
    const comment = resolveThresholdComment(options?.comment, null, source);

    const cat = await db.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id: categoryId },
        data: { monthlyAlertMinor: amountMinor },
      });

      await tx.budget.upsert({
        where: { categoryId_period: { categoryId, period: currentMonthKey } },
        create: { categoryId, period: currentMonthKey, amountMinor },
        update: { amountMinor },
      });

      await tx.alertRule.create({
        data: {
          scope: "threshold_log",
          categoryId,
          strategy: currentMonthKey,
          enabled: false,
          params: JSON.stringify({
            monthKey: currentMonthKey,
            categoryId,
            categoryName: updated.name,
            previousMinor: prevEffective,
            amountMinor,
            comment,
            source,
            changedAt: now.toISOString(),
          }),
        },
      });

      return updated;
    });

    revalidatePath("/", "layout");
    return {
      ok: `Updated ${cat.name} threshold to $${Math.round(amountMinor / 100)} (${currentMonthKey} · "${comment}")`,
    };
  } catch {
    return { error: "Could not update category threshold" };
  }
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
