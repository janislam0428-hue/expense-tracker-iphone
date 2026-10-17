"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { toMinor } from "@/lib/money";
import { normalizeMerchant, shortHash } from "@/lib/text";
import { formatInZone } from "@/lib/time";
import { decideReview } from "@/lib/review/rules";

const addSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter a valid amount, e.g. 45 or 45.50"),
  merchant: z.string().trim().min(1, "Merchant name is required"),
  occurredAt: z.string().optional(),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  sourceId: z.string().min(1, "Select a payment source"),
  purposeId: z.string().optional(),
  type: z.enum(["expense", "income", "top_up", "refund", "transfer"]).default("expense"),
  notes: z.string().optional(),
});

export type ActionState = { ok?: string; error?: string } | undefined;

export async function addTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid form data" };
  }

  const d = parsed.data;
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const amountMinor = toMinor(d.amount);
  const merchantNormalized = normalizeMerchant(d.merchant);
  const occurredAt = d.occurredAt ? new Date(d.occurredAt) : new Date();

  const category = d.categoryId ? await db.category.findUnique({ where: { id: d.categoryId } }) : null;
  const subcategory =
    d.subcategoryId && category
      ? await db.category.findFirst({ where: { id: d.subcategoryId, parentId: category.id, archived: false } })
      : null;

  const review = decideReview({
    amountMinor,
    type: d.type,
    categoryAmbiguous: category ? category.ambiguous : null,
    hasRulePurpose: !!(d.categoryId || d.purposeId),
    isPersonToPerson: false,
    reviewThresholdMinor: settings.reviewThresholdMinor,
  });

  const dayStr = formatInZone(occurredAt, "yyyy-MM-dd", settings.timezone);
  const fingerprint = `manual:${shortHash(`${d.sourceId}|${dayStr}|${amountMinor}|${merchantNormalized}`)}`;

  await db.transaction.create({
    data: {
      occurredAt,
      datePrecision: "minute",
      amountMinor,
      currency: settings.currency,
      merchant: d.merchant,
      merchantNormalized,
      categoryId: category?.id ?? null,
      subcategoryId: subcategory?.id ?? null,
      sourceId: d.sourceId,
      channel: "manual",
      type: d.type,
      purposeId: d.purposeId || null,
      purposeStatus: category ? "confirmed" : review.status,
      reviewReasons: category ? "[]" : JSON.stringify(review.reasons),
      notes: d.notes || null,
      fingerprint,
      isDemo: false,
    },
  });

  revalidatePath("/", "layout");
  return { ok: `Added ${d.merchant} (${settings.currency} ${d.amount})` };
}

export async function deleteTransaction(id: string): Promise<ActionState> {
  await requireAuth();
  try {
    await db.transaction.delete({ where: { id } });
    revalidatePath("/", "layout");
    return { ok: "Transaction deleted" };
  } catch {
    return { error: "Could not delete transaction" };
  }
}
