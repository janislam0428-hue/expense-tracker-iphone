"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { demoScope, getSettings } from "@/lib/settings";

export async function confirmPurpose(data: {
  transactionId: string;
  purposeId: string;
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

    const purpose = await db.purpose.findUnique({ where: { id: data.purposeId } });
    if (!purpose) return { error: "Invalid purpose" };
    const categoryId = data.categoryId === undefined ? tx.categoryId : data.categoryId || null;
    const subcategoryId = data.subcategoryId === undefined
      ? (categoryId === tx.categoryId ? tx.subcategoryId : null)
      : data.subcategoryId || null;
    if (categoryId) {
      const category = await db.category.findFirst({
        where: { id: categoryId, parentId: null, archived: false },
      });
      if (!category) return { error: "Select an active category" };
    }
    if (subcategoryId) {
      const child = categoryId && await db.category.findFirst({
        where: { id: subcategoryId, parentId: categoryId, archived: false },
      });
      if (!child) return { error: "Subcategory does not belong to this category" };
    }

    await db.$transaction(async (db) => {
      await db.transaction.update({
        where: { id: data.transactionId },
        data: {
          purposeId: data.purposeId,
          categoryId,
          subcategoryId,
          purposeStatus: "confirmed",
          reviewReasons: "[]",
        },
      });

      if (data.saveRule && tx.merchantNormalized) {
        // Create or update merchant rule
        const existingRule = await db.merchantRule.findFirst({
          where: { pattern: tx.merchantNormalized, isDemo: tx.isDemo },
        });

        if (!existingRule) {
          await db.merchantRule.create({
            data: {
              pattern: tx.merchantNormalized,
              matchType: "contains",
              categoryId: subcategoryId ?? categoryId,
              purposeId: data.purposeId,
              hits: 1,
              isDemo: tx.isDemo,
            },
          });
        } else {
          await db.merchantRule.update({
            where: { id: existingRule.id },
            data: {
              purposeId: data.purposeId,
              categoryId: subcategoryId ?? categoryId,
            },
          });
        }
      }
    });

    revalidatePath("/", "layout");
    return { ok: "Confirmed" };
  } catch (err) {
    console.error("Confirm purpose error:", err);
    return { error: "Failed to confirm transaction" };
  }
}

export async function confirmAllAsPersonal(): Promise<{ ok?: string; error?: string }> {
  await requireAuth();
  try {
    const settings = await getSettings();
    const personalPurpose = await db.purpose.findFirst({ where: { name: "Personal" } });
    if (!personalPurpose) return { error: "Personal purpose not found" };

    const updated = await db.transaction.updateMany({
      where: { ...demoScope(settings), purposeStatus: "needs_review", duplicateOfId: null },
      data: {
        purposeId: personalPurpose.id,
        purposeStatus: "confirmed",
        reviewReasons: "[]",
      },
    });

    revalidatePath("/", "layout");
    return { ok: `Confirmed ${updated.count} transaction(s) as Personal.` };
  } catch {
    return { error: "Could not confirm transactions" };
  }
}
