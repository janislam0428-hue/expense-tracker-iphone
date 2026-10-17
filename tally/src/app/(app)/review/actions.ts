"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { demoScope, getSettings } from "@/lib/settings";

export async function confirmPurpose(data: {
  transactionId: string;
  purposeId?: string | null;
  categoryId?: string;
  subcategoryId?: string | null;
  saveRule?: boolean;
}): Promise<{ ok?: string; error?: string }> {
  await requireAuth();
  try {
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
          purposeId: resolvedPurposeId,
          categoryId,
          subcategoryId,
          purposeStatus: "confirmed",
          reviewReasons: "[]",
        },
      });

      if (data.saveRule && tx.merchantNormalized) {
        const existingRule = await db.merchantRule.findFirst({
          where: { pattern: tx.merchantNormalized, isDemo: tx.isDemo },
        });

        if (!existingRule) {
          await db.merchantRule.create({
            data: {
              pattern: tx.merchantNormalized,
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
