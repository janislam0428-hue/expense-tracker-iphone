"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { toMinor } from "@/lib/money";
import { normalizeMerchant, shortHash } from "@/lib/text";
import { formatInZone, zonedDate } from "@/lib/time";
import { decideReview } from "@/lib/review/rules";

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

const txFormSchema = z.object({
  id: z.string().optional(),
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

function parseLocalDateTime(value: string | undefined | null, zone: string): Date | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (m) {
    return zonedDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), zone);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function addTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const parsed = txFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid form data" };
  }

  const d = parsed.data;
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const amountMinor = toMinor(d.amount);
  const cleanedMerchant = cleanOcrMerchantName(d.merchant) || d.merchant;
  const merchantNormalized = normalizeMerchant(cleanedMerchant);
  const occurredAt = parseLocalDateTime(d.occurredAt, settings.timezone) ?? new Date();

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
      merchant: cleanedMerchant,
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
  return { ok: `Added ${cleanedMerchant} (${settings.currency} ${d.amount})` };
}

export async function updateTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const parsed = txFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !parsed.data.id) {
    return { error: parsed.error?.issues[0]?.message ?? "Invalid transaction data" };
  }

  const d = parsed.data;
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const existing = await db.transaction.findUnique({ where: { id: d.id } });
  if (!existing) return { error: "Transaction not found" };

  const amountMinor = toMinor(d.amount);
  const cleanedMerchant = cleanOcrMerchantName(d.merchant) || d.merchant;
  const merchantNormalized = normalizeMerchant(cleanedMerchant);
  const occurredAt = parseLocalDateTime(d.occurredAt, settings.timezone) ?? existing.occurredAt;

  const category =
    d.categoryId && d.categoryId !== "none"
      ? await db.category.findUnique({ where: { id: d.categoryId } })
      : null;
  const subcategory =
    d.subcategoryId && d.subcategoryId !== "none" && category
      ? await db.category.findFirst({ where: { id: d.subcategoryId, parentId: category.id, archived: false } })
      : null;

  await db.transaction.update({
    where: { id: d.id },
    data: {
      merchant: cleanedMerchant,
      merchantNormalized,
      amountMinor,
      occurredAt,
      datePrecision: "minute",
      type: d.type,
      sourceId: d.sourceId,
      categoryId: category?.id ?? null,
      subcategoryId: subcategory?.id ?? null,
      description: d.notes?.trim() || null,
      notes: null,
      purposeStatus: "confirmed",
      reviewReasons: "[]",
    },
  });

  if (category) {
    const rulePattern = canonicalizeMerchantKey(cleanedMerchant) || merchantNormalized;
    if (rulePattern && rulePattern.length >= 2 && !GENERIC_RULE_BLACKLIST.has(rulePattern)) {
      const existingRules = await db.merchantRule.findMany({ where: { isDemo: existing.isDemo } });
      const matchedRule = existingRules.find(
        (r) => r.pattern.toLowerCase().trim() === rulePattern || doesMerchantMatchRule(cleanedMerchant, r.pattern),
      );
      if (!matchedRule) {
        await db.merchantRule.create({
          data: {
            pattern: rulePattern,
            matchType: "contains",
            categoryId: subcategory?.id ?? category.id,
            hits: 1,
            lastUsedAt: new Date(),
            isDemo: existing.isDemo,
          },
        });
      } else {
        await db.merchantRule.update({
          where: { id: matchedRule.id },
          data: {
            pattern: rulePattern,
            categoryId: subcategory?.id ?? category.id,
            hits: { increment: 1 },
            lastUsedAt: new Date(),
          },
        });
      }

      const others = await db.transaction.findMany({
        where: {
          isDemo: existing.isDemo,
          id: { not: d.id },
          OR: [{ categoryId: null }, { purposeStatus: "needs_review" }],
        },
        select: { id: true, merchant: true, amountMinor: true, counterparty: true },
      });

      const matchingOthers = others.filter((t) => doesMerchantMatchRule(t.merchant, rulePattern));
      for (const other of matchingOthers) {
        const cleanOtherMerchant = cleanOcrMerchantName(other.merchant) || other.merchant;
        const shouldConfirm = other.amountMinor <= settings.reviewThresholdMinor && !other.counterparty;
        await db.transaction.update({
          where: { id: other.id },
          data: {
            merchant: cleanOtherMerchant,
            merchantNormalized: normalizeMerchant(cleanOtherMerchant),
            categoryId: category.id,
            subcategoryId: subcategory?.id ?? null,
            ...(shouldConfirm ? { purposeStatus: "confirmed", reviewReasons: "[]" } : {}),
          },
        });
      }
    }
  }

  revalidatePath("/", "layout");
  return { ok: `Updated ${cleanedMerchant}` };
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
