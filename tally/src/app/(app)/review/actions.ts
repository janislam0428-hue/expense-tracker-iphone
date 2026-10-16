"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";

export async function confirmPurpose(data: {
  transactionId: string;
  purposeId: string;
  saveRule?: boolean;
}): Promise<{ ok?: string; error?: string }> {
  await requireAuth();
  try {
    const tx = await db.transaction.findUnique({
      where: { id: data.transactionId },
      include: { category: true },
    });

    if (!tx) return { error: "Transaction not found" };

    await db.transaction.update({
      where: { id: data.transactionId },
      data: {
        purposeId: data.purposeId,
        purposeStatus: "confirmed",
      },
    });

    if (data.saveRule && tx.merchantNormalized) {
      // Create or update merchant rule
      const existingRule = await db.merchantRule.findFirst({
        where: { pattern: tx.merchantNormalized },
      });

      if (!existingRule) {
        await db.merchantRule.create({
          data: {
            pattern: tx.merchantNormalized,
            matchType: "contains",
            categoryId: tx.categoryId,
            purposeId: data.purposeId,
            hits: 1,
            isDemo: false,
          },
        });
      } else {
        await db.merchantRule.update({
          where: { id: existingRule.id },
          data: {
            purposeId: data.purposeId,
            categoryId: tx.categoryId ?? existingRule.categoryId,
          },
        });
      }
    }

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
    const personalPurpose = await db.purpose.findFirst({ where: { name: "Personal" } });
    if (!personalPurpose) return { error: "Personal purpose not found" };

    const updated = await db.transaction.updateMany({
      where: { purposeStatus: "needs_review", duplicateOfId: null },
      data: {
        purposeId: personalPurpose.id,
        purposeStatus: "confirmed",
      },
    });

    revalidatePath("/", "layout");
    return { ok: `Confirmed ${updated.count} transaction(s) as Personal.` };
  } catch {
    return { error: "Could not confirm transactions" };
  }
}
