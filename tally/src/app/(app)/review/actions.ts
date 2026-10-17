"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { toMinor } from "@/lib/money";
import { demoScope, getSettings } from "@/lib/settings";
import { normalizeMerchant } from "@/lib/text";
import { zonedDate } from "@/lib/time";

function parseLocalDateTime(value: string | undefined | null, zone: string): Date | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    return zonedDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), zone);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function confirmPurpose(data: {
  transactionId: string;
  purposeId?: string | null;
  categoryId?: string;
  subcategoryId?: string | null;
  merchant?: string;
  amount?: string;
  occurredAt?: string;
  description?: string | null;
  saveRule?: boolean;
}): Promise<{ ok?: string; error?: string }> {
  await requireAuth();
  try {
    const settings = await getSettings();
    const tx = await db.transaction.findUnique({
      where: { id: data.transactionId },
      include: { category: true },
    });

    if (!tx) return { error: "Transaction not found" };

    let resolvedPurposeId: string | null = tx.purposeId;
    if (data.purposeId) {
      const purpose = await db.purpose.findUnique({ where: { id: data.purposeId } });
      if (purpose) resolvedPurposeId = purpose.id;
    }

    const updatedMerchant = data.merchant !== undefined && data.merchant.trim() ? data.merchant.trim() : tx.merchant;
    const updatedMerchantNormalized = normalizeMerchant(updatedMerchant);

    let updatedAmountMinor = tx.amountMinor;
    if (data.amount !== undefined && data.amount.trim() !== "") {
      const cleanAmt = data.amount.trim().replace(/[^0-9.]/g, "");
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleanAmt)) {
        return { error: "Enter a valid amount, e.g. 8.20" };
      }
      updatedAmountMinor = toMinor(cleanAmt);
    }

    const parsedDate = parseLocalDateTime(data.occurredAt, settings.timezone);
    const updatedOccurredAt = parsedDate ?? tx.occurredAt;
    const updatedDescription =
      data.description === undefined ? tx.description : data.description?.trim() || null;

    const categoryId = data.categoryId === undefined ? tx.categoryId : data.categoryId || null;
    const subcategoryId =
      data.subcategoryId === undefined
        ? categoryId === tx.categoryId
          ? tx.subcategoryId
          : null
        : data.subcategoryId || null;

    if (categoryId) {
      const category = await db.category.findFirst({
        where: { id: categoryId, parentId: null, archived: false },
      });
      if (!category) return { error: "Select an active category" };
    }
    if (subcategoryId) {
      const child =
        categoryId &&
        (await db.category.findFirst({
          where: { id: subcategoryId, parentId: categoryId, archived: false },
        }));
      if (!child) return { error: "Subcategory does not belong to this category" };
    }

    await db.$transaction(async (db) => {
      await db.transaction.update({
        where: { id: data.transactionId },
        data: {
          merchant: updatedMerchant,
          merchantNormalized: updatedMerchantNormalized,
          amountMinor: updatedAmountMinor,
          occurredAt: updatedOccurredAt,
          description: updatedDescription,
          purposeId: resolvedPurposeId,
          categoryId,
          subcategoryId,
          purposeStatus: "confirmed",
          reviewReasons: "[]",
        },
      });

      if (data.saveRule && updatedMerchantNormalized) {
        const existingRule = await db.merchantRule.findFirst({
          where: { pattern: updatedMerchantNormalized, isDemo: tx.isDemo },
        });

        if (!existingRule) {
          await db.merchantRule.create({
            data: {
              pattern: updatedMerchantNormalized,
              matchType: "contains",
              categoryId: subcategoryId ?? categoryId,
              purposeId: resolvedPurposeId,
              hits: 1,
              isDemo: tx.isDemo,
            },
          });
        } else {
          await db.merchantRule.update({
            where: { id: existingRule.id },
            data: {
              categoryId: subcategoryId ?? categoryId,
              ...(resolvedPurposeId ? { purposeId: resolvedPurposeId } : {}),
            },
          });
        }
      }
    });

    revalidatePath("/", "layout");
    return { ok: "Confirmed" };
  } catch (err) {
    console.error("Confirm transaction error:", err);
    return { error: "Failed to confirm transaction" };
  }
}

export async function deletePendingTransaction(transactionId: string): Promise<{ ok?: string; error?: string }> {
  await requireAuth();
  try {
    await db.transaction.delete({ where: { id: transactionId } });
    revalidatePath("/", "layout");
    return { ok: "Deleted transaction" };
  } catch {
    return { error: "Could not delete transaction" };
  }
}

export async function confirmAllAsPersonal(): Promise<{ ok?: string; error?: string }> {
  await requireAuth();
  try {
    const settings = await getSettings();
    const personalPurpose = await db.purpose.findFirst({ where: { name: "Personal" } });

    const updated = await db.transaction.updateMany({
      where: { ...demoScope(settings), purposeStatus: "needs_review", duplicateOfId: null },
      data: {
        ...(personalPurpose ? { purposeId: personalPurpose.id } : {}),
        purposeStatus: "confirmed",
        reviewReasons: "[]",
      },
    });

    revalidatePath("/", "layout");
    return { ok: `Confirmed ${updated.count} transaction(s).` };
  } catch {
    return { error: "Could not confirm transactions" };
  }
}
