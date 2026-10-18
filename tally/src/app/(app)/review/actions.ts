"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { toMinor } from "@/lib/money";
import { demoScope, getSettings } from "@/lib/settings";
import { normalizeMerchant } from "@/lib/text";
import { zonedDate } from "@/lib/time";

const GENERIC_RULE_BLACKLIST = new Set([
  "octopus",
  "octopus 1",
  "octopus 2",
  "octopus purchase",
  "purchase",
  "payme",
  "hang seng",
  "hang seng card",
  "visa",
  "mastercard",
  "八達通",
]);

function cleanOcrMerchantName(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(
      /(?:^|\s)[<‹＜«←⬅️⌃^]*\s*(?:octopus|八達通)(?:\s+\d+)?\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/gi,
      " ",
    )
    .replace(
      /^[<‹＜«←⬅️]+\s*(?:octopus|八達通)(?:\s+\d+)?(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/i,
      "",
    )
    .replace(
      /^(?:octopus|八達通)\s+\d+(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?(?:\s+|$)/i,
      "",
    )
    .replace(/(?:^|\s)[<‹＜«←⬅️]*\s*\b\d{7,12}\s*[\(\[\{]\d+[\)\]\}]?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/g, " ")
    .replace(/^[<‹＜«←⬅️•·▪▫◦●○■□▲△▼▽◆◇★☆⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡]+\s*/u, "")
    .replace(
      /^(?:[印日目甲由申田口回囚四皿且貝見頁車凸凹尚向同团因固國圖片币巾中内肉門間問開関]\s+|[印日目甲由申田口回囚四皿且貝見頁凸凹](?=[A-Za-z]))/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeMerchantKey(input: string): string {
  return normalizeMerchant(cleanOcrMerchantName(input))
    .replace(/^(?:octopus|八達通)(?:\s+\d+)?(?:\s+\d{6,12}(?:\s+\d+)?)?\s*/i, "")
    .replace(/\b\d{7,12}\b/g, " ")
    .replace(/^(?:cup|visa|master|mastercard|amex|unionpay)\s+/i, "")
    .replace(/^(?:kpay|bbmsl|qfpay|yedpay|stripe|sq|paypal|alipay|wechat|shopify|adyen)\s+/i, "")
    .replace(/\b(?:group\s+limited|holdings?\s+limited|company\s+limited|co\s+ltd|limited|ltd|inc|corp|corporation)\b/g, " ")
    .replace(/\bwel+come\b/g, "wellcome")
    .replace(/\bminibuses\b/g, "minibus")
    .replace(/\bbuses\b/g, "bus")
    .replace(/\s+/g, " ")
    .trim();
}

function doesMerchantMatchRule(merchant: string, rulePattern: string): boolean {
  const normMerchant = normalizeMerchant(cleanOcrMerchantName(merchant));
  const normRule = normalizeMerchant(cleanOcrMerchantName(rulePattern));
  if (!normMerchant || !normRule || normRule.length < 2) return false;
  if (GENERIC_RULE_BLACKLIST.has(normMerchant) || GENERIC_RULE_BLACKLIST.has(normRule)) return false;

  const canonMerchant = canonicalizeMerchantKey(merchant);
  const canonRule = canonicalizeMerchantKey(rulePattern);
  if (!canonMerchant || !canonRule || canonRule.length < 2) return false;
  if (GENERIC_RULE_BLACKLIST.has(canonMerchant) || GENERIC_RULE_BLACKLIST.has(canonRule)) return false;

  if (normMerchant.includes(normRule) || (normRule.length >= 3 && normRule.includes(normMerchant))) {
    return true;
  }
  return canonMerchant.includes(canonRule) || (canonRule.length >= 3 && canonRule.includes(canonMerchant));
}

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
  ruleOnly?: boolean;
}): Promise<{
  ok?: string;
  error?: string;
  autoConfirmedIds?: string[];
  autoUpdatedCount?: number;
}> {
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

    const rawMerchant = data.merchant !== undefined && data.merchant.trim() ? data.merchant.trim() : tx.merchant;
    const updatedMerchant = cleanOcrMerchantName(rawMerchant) || rawMerchant;
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

    let categoryName = tx.category?.name ?? "selected category";
    if (categoryId) {
      const category = await db.category.findFirst({
        where: { id: categoryId, parentId: null, archived: false },
      });
      if (!category) return { error: "Select an active category" };
      categoryName = category.name;
    }
    if (subcategoryId) {
      const child =
        categoryId &&
        (await db.category.findFirst({
          where: { id: subcategoryId, parentId: categoryId, archived: false },
        }));
      if (!child) return { error: "Subcategory does not belong to this category" };
    }

    const autoConfirmedIds: string[] = [];
    let autoUpdatedCount = 0;

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
          ...(data.ruleOnly
            ? {}
            : {
                purposeStatus: "confirmed",
                reviewReasons: "[]",
              }),
        },
      });

      if ((data.saveRule || data.ruleOnly) && updatedMerchantNormalized && categoryId) {
        const rulePattern = canonicalizeMerchantKey(updatedMerchant) || updatedMerchantNormalized;
        if (rulePattern.length >= 2 && !GENERIC_RULE_BLACKLIST.has(rulePattern)) {
          const existingRules = await db.merchantRule?.findMany
            ? await db.merchantRule.findMany({ where: { isDemo: tx.isDemo } })
            : [];
          const existingRule =
            existingRules.find(
              (r) => r.pattern.toLowerCase().trim() === rulePattern || doesMerchantMatchRule(updatedMerchant, r.pattern),
            ) ??
            (await db.merchantRule.findFirst?.({
              where: { pattern: rulePattern, isDemo: tx.isDemo },
            }));

          if (!existingRule) {
            await db.merchantRule.create({
              data: {
                pattern: rulePattern,
                matchType: "contains",
                categoryId: subcategoryId ?? categoryId,
                purposeId: resolvedPurposeId,
                hits: 1,
                lastUsedAt: new Date(),
                isDemo: tx.isDemo,
              },
            });
          } else {
            await db.merchantRule.update({
              where: { id: existingRule.id },
              data: {
                pattern: rulePattern,
                categoryId: subcategoryId ?? categoryId,
                ...(resolvedPurposeId ? { purposeId: resolvedPurposeId } : {}),
                hits: { increment: 1 },
                lastUsedAt: new Date(),
              },
            });
          }

          if (typeof db.transaction.findMany === "function") {
            const otherTransactions = await db.transaction.findMany({
              where: {
                isDemo: tx.isDemo,
                id: { not: data.transactionId },
              },
              select: {
                id: true,
                merchant: true,
                purposeStatus: true,
                amountMinor: true,
                counterparty: true,
              },
            });

            const matchingOthers = (otherTransactions ?? []).filter((t) =>
              doesMerchantMatchRule(t.merchant, rulePattern),
            );

            for (const other of matchingOthers) {
              const cleanOtherMerchant = cleanOcrMerchantName(other.merchant) || other.merchant;
              const shouldAutoConfirm =
                !data.ruleOnly &&
                other.purposeStatus === "needs_review" &&
                other.amountMinor <= (settings.reviewThresholdMinor ?? 50000) &&
                !other.counterparty;

              await db.transaction.update({
                where: { id: other.id },
                data: {
                  merchant: cleanOtherMerchant,
                  merchantNormalized: normalizeMerchant(cleanOtherMerchant),
                  categoryId,
                  subcategoryId,
                  ...(resolvedPurposeId ? { purposeId: resolvedPurposeId } : {}),
                  ...(shouldAutoConfirm
                    ? {
                        purposeStatus: "confirmed",
                        reviewReasons: "[]",
                      }
                    : {}),
                },
              });

              autoUpdatedCount++;
              if (shouldAutoConfirm) {
                autoConfirmedIds.push(other.id);
              }
            }
          }
        }
      }
    });

    revalidatePath("/", "layout");
    if (data.ruleOnly) {
      return {
        ok: `Rule saved: categorized ${autoUpdatedCount + 1} matching "${updatedMerchant}" transaction${autoUpdatedCount === 0 ? "" : "s"} as ${categoryName}`,
        autoUpdatedCount: autoUpdatedCount + 1,
      };
    }
    return {
      ok: "Confirmed",
      ...(autoConfirmedIds.length > 0 ? { autoConfirmedIds } : {}),
      ...(autoUpdatedCount > 0 ? { autoUpdatedCount } : {}),
    };
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
