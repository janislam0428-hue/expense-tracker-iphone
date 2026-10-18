import type { Db } from "@/lib/db-client";
import { decideReview } from "@/lib/review/rules";
import { normalizeMerchant, shortHash } from "@/lib/text";
import { formatMoney } from "@/lib/money";
import { dayStart, formatInZone } from "@/lib/time";
import {
  isBalanceLine,
  isGenericWalletMerchant,
  isTopUpLine,
  parseNotification,
  type ParsedNotification,
} from "./notification";
import type { Channel } from "@/lib/domain";
import { classifyMerchant } from "@/lib/reference/classify";

export type IngestResult = {
  ok: boolean;
  message: string;
  isDuplicate?: boolean;
  updated?: boolean;
  transactionId?: string;
  merchant?: string;
  amountFormatted?: string;
  categoryName?: string;
  purposeStatus?: string;
};

type ExtendedClassification = {
  category: string;
  subcategory?: string;
  isKeywordFallback?: boolean;
};

const GENERIC_WALLET_MERCHANTS = [
  "octopus purchase",
  "octopus",
  "purchase",
  "bus",
  "train",
  "transit",
  "minibus",
  "ferry",
  "tram",
  "light rail",
  "public transport",
  "八達通",
  "零售",
  "消費",
  "付款",
];

/**
 * Strips leading OCR icon misreads (e.g. "印 Green Minibuses" -> "Green Minibuses", "印 MTR Corporation Limited" -> "MTR Corporation Limited").
 */
function cleanOcrMerchantName(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/^[•·▪▫◦●○■□▲△▼▽◆◇★☆⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡]+\s*/u, "")
    .replace(
      /^(?:[印日目甲由申田口回囚四皿且貝見頁車凸凹尚向同团因固國圖片币巾中内肉門間問開関]\s+|[印日目甲由申田口回囚四皿且貝見頁凸凹](?=[A-Za-z]))/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMerchantForSearch(merchant: string): string {
  return cleanOcrMerchantName(merchant)
    .replace(/^(?:CUP|VISA|MASTER|MASTERCARD|AMEX|UNIONPAY)\s+/i, "")
    .replace(/^(?:KPAY|BBMSL|QFPAY|YEDPAY|STRIPE|SQ|PAYPAL|ALIPAY|WECHAT|SHOPIFY|adyen)\s*[*#-]\s*/i, "")
    .replace(
      /\b(?:\(GROUP\)\s*LIMITED|GROUP\s*LIMITED|HOLDINGS?\s*LIMITED|COMPANY\s*LIMITED|CO\.?,?\s*LTD\.?|LIMITED|LTD\.?|INC\.?|CORP\.?|CORPORATION)\b/gi,
      " ",
    )
    .replace(/\b(?:HONG\s*KONG|HK)\b/gi, " ")
    .replace(/\b(?:CH\d+|BR\d+|SHOP\s*\d+|#[A-Z0-9-]+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeMerchantKey(input: string): string {
  return normalizeMerchant(cleanOcrMerchantName(input))
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
  if (!normMerchant || !normRule) return false;
  if (normMerchant.includes(normRule) || (normRule.length >= 3 && normRule.includes(normMerchant))) {
    return true;
  }
  const canonMerchant = canonicalizeMerchantKey(merchant);
  const canonRule = canonicalizeMerchantKey(rulePattern);
  if (!canonMerchant || !canonRule) return false;
  return canonMerchant.includes(canonRule) || (canonRule.length >= 3 && canonRule.includes(canonMerchant));
}

function scoreWebTextForCategory(webText: string): ExtendedClassification | null {
  const lower = webText.toLowerCase();
  if (!lower || lower.length < 5) return null;

  const buckets: Array<{
    category: string;
    subcategory?: string;
    keywords: Array<[RegExp, number]>;
  }> = [
    {
      category: "Food",
      subcategory: "Bakery",
      keywords: [
        [/\bpatisserie\b|\bboulangerie\b|\bbakery\b|\bbakehouse\b/g, 5],
        [/\bcake\b|\bpastry\b|\bpastries\b|\bcroissant\b|\btart\b|\bmacaron\b|\bbread\b|\bsourdough\b/g, 3],
        [/麵包|餅店|西餅|蛋糕|烘焙/g, 5],
      ],
    },
    {
      category: "Food",
      subcategory: "Cafe",
      keywords: [
        [/\bcafe\b|\bcafé\b|\bcoffee shop\b|\bcoffee roaster\b|\bespresso\b|\blatte\b|\bcappuccino\b|\bmatcha\b/g, 4],
        [/\bbubble tea\b|\bboba\b|\btea shop\b|\btea house\b|\bhandcrafted tea\b/g, 4],
        [/咖啡|茶飲|手搖飲|精品咖啡/g, 4],
      ],
    },
    {
      category: "Food",
      subcategory: "Fast food",
      keywords: [
        [/\bfast food\b|\bburger\b|\bfried chicken\b|\btakeaway\b|\bquick service\b/g, 4],
        [/快餐|漢堡/g, 4],
      ],
    },
    {
      category: "Food",
      subcategory: "Restaurant",
      keywords: [
        [/\bopenrice\b|開飯喇/g, 4],
        [
          /\brestaurant\b|\bdining\b|\bbistro\b|\btrattoria\b|\bizakaya\b|\bramen\b|\bsushi\b|\bomakase\b|\byakiniku\b|\bhotpot\b|\bsteakhouse\b|\bdim sum\b|\bnoodle\b|\bdumpling\b|\bcha chaan teng\b|\bcuisine\b/g,
          4,
        ],
        [/餐廳|茶餐廳|酒樓|料理|火鍋|燒肉|壽司|拉麵|小食|粉麵|冰室/g, 4],
      ],
    },
    {
      category: "Gathering",
      subcategory: "Gathering activity",
      keywords: [
        [/\bkaraoke\b|\bparty room\b|\bboard game\b|\bbowling\b|\bescape room\b|\bpool hall\b|\bbilliards\b/g, 5],
        [/唱k|派對房間|桌遊/g, 5],
      ],
    },
    {
      category: "Gathering",
      subcategory: "Drinks & desserts",
      keywords: [
        [/\bcocktail bar\b|\bwine bar\b|\bcraft beer\b|\bpub\b|\btaproom\b|\bspeakeasy\b|\bdessert shop\b|\bshaved ice\b|\bgelato\b/g, 4],
        [/酒吧|甜品|糖水/g, 4],
      ],
    },
    {
      category: "Groceries",
      subcategory: "Supermarket",
      keywords: [
        [/\bsupermarket\b|\bgrocery\b|\bgroceries\b|\bfood market\b|\bfrozen food\b|\borganic market\b/g, 5],
        [/超市|超級市場|凍肉|食品市場/g, 5],
      ],
    },
    {
      category: "Groceries",
      subcategory: "Convenience store",
      keywords: [[/\bconvenience store\b|便利店/g, 5]],
    },
    {
      category: "Personal Expense",
      subcategory: "Skincare",
      keywords: [
        [/\bskincare\b|\bcosmetics?\b|\bperfume\b|\bfragrance\b|\bserum\b|\bcleanser\b|\bbeauty store\b/g, 5],
        [/護膚|美妝|香水|化妝品店/g, 5],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Makeup",
      keywords: [[/\bmakeup\b|\bmake-up\b|\blipstick\b|\bfoundation\b|\beyeshadow\b|彩妝/g, 5]],
    },
    {
      category: "Personal Expense",
      subcategory: "Beauty treatments",
      keywords: [
        [/\bhair salon\b|\bnail salon\b|\bmanicure\b|\bpedicure\b|\bfacial\b|\bspa\b|\bmassage\b|\bbarbershop\b|\beyelash\b|\bmedispa\b/g, 5],
        [/美容|美甲|髮型|按摩|水療/g, 5],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Accessories",
      keywords: [
        [/\boptical\b|\beyewear\b|\bglasses\b|\bsunglasses\b|\bcontact lens\b|\boptometrist\b|\bjewellery\b|\bjewelry\b|\bwatch(?:es)?\b|\bhandbag\b/g, 5],
        [/眼鏡|配鏡|首飾|珠寶|鐘錶|手袋/g, 5],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Daily essentials",
      keywords: [
        [/\bpharmacy\b|\bpharmaceutical\b|\bdispensary\b|\bdrugstore\b|\bmedicine\b|\bclinic\b|\bmedical\b|\bdental\b|\bdentist\b|\btoiletries\b/g, 5],
        [/藥房|藥行|藥妝|診所|醫療|牙科|日用品/g, 5],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Health & supplements",
      keywords: [
        [/\bsupplements?\b|\bvitamins?\b|\bprobiotics\b|\bhealth food\b|\bnutrition\b/g, 5],
        [/保健品|維他命|營養補充/g, 5],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Leisure clothing",
      keywords: [
        [/\bapparel\b|\bclothing\b|\bfashion\b|\bboutique\b|\bmenswear\b|\bwomenswear\b|\bstreetwear\b|\bsportswear\b|\bfootwear\b|\bsneakers\b|\bshoes\b/g, 4],
        [/時裝|服飾|服裝|波鞋|女裝|男裝/g, 4],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Electronics",
      keywords: [
        [/\belectronics\b|\bgadgets?\b|\bcomputer\b|\blaptop\b|\bsmartphone\b|\baudio\b|\bcamera\b|\bhome appliance\b/g, 5],
        [/電器|電腦|數碼|音響|相機/g, 5],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Home",
      keywords: [
        [/\bfurniture\b|\bhomeware\b|\bhousehold\b|\bkitchenware\b|\bbedding\b|\bhome decor\b|\bhardware store\b/g, 5],
        [/傢俬|家具|家品|五金|廚具/g, 5],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Leisure activities",
      keywords: [
        [/\bcinema\b|\bmovie\b|\btheatre\b|\bmuseum\b|\btheme park\b|\bexhibition\b|\bconcert\b|\bamusement\b|\bpilates\b|\byoga\b|\bbouldering\b/g, 4],
        [/戲院|電影|展覽|博物館|瑜伽|普拉提|抱石/g, 4],
      ],
    },
    {
      category: "Personal Expense",
      subcategory: "Learning & development",
      keywords: [
        [/\bbookstore\b|\bbookshop\b|\bstationery\b|\btuition\b|\blanguage school\b|\btraining center\b/g, 5],
        [/書店|書局|文具|課程|教育/g, 5],
      ],
    },
    {
      category: "Transport",
      subcategory: "Public transport",
      keywords: [
        [/\bpublic transport\b|\bminibus\b|\bbus route\b|\bferry\b|\bmtr\b|\btramway\b|\brailway\b/g, 5],
        [/巴士|小巴|港鐵|渡輪|交通/g, 5],
      ],
    },
    {
      category: "Transport",
      subcategory: "Taxi/Uber",
      keywords: [[/\btaxi\b|\bcab\b|\bride-hailing\b|的士/g, 5]],
    },
    {
      category: "Travel Expense",
      subcategory: "Flights",
      keywords: [[/\bairline\b|\bairways\b|\bflight\b|\baviation\b|航空|機票/g, 5]],
    },
    {
      category: "Travel Expense",
      subcategory: "Accommodation",
      keywords: [[/\bhotel\b|\bresort\b|\bhostel\b|\baccommodation\b|酒店|渡假村/g, 5]],
    },
    {
      category: "Gift",
      subcategory: "Gift",
      keywords: [[/\bflorist\b|\bflower shop\b|\bbouquet\b|\bgift shop\b|\bhamper\b|花店|花藝|禮品/g, 5]],
    },
  ];

  let best: { category: string; subcategory?: string; score: number } | null = null;
  for (const b of buckets) {
    let score = 0;
    for (const [regex, weight] of b.keywords) {
      const matches = lower.match(regex);
      if (matches) score += matches.length * weight;
    }
    if (score >= 4 && (!best || score > best.score)) {
      best = { category: b.category, subcategory: b.subcategory, score };
    }
  }
  return best ? { category: best.category, subcategory: best.subcategory, isKeywordFallback: false } : null;
}

async function searchAndClassifyMerchant(merchant: string): Promise<ExtendedClassification | null> {
  const local = classifyMerchant(merchant) as ExtendedClassification | null;
  if (local && !local.isKeywordFallback) {
    return local;
  }

  const cleaned = cleanMerchantForSearch(merchant);
  const norm = normalizeMerchant(cleaned);
  if (!norm || norm.length < 2 || /^(?:octopus|octopus purchase|purchase|payment|transfer|unknown)$/.test(norm)) {
    return local;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const prompt = `You are classifying a Hong Kong merchant name from a credit card, Octopus, or PayMe receipt into an expense category.
Merchant: "${cleaned}" (raw: "${merchant}")
Choose exactly ONE category and subcategory from this list:
- Transport: Public transport | Taxi/Uber | Other transport
- Food: Restaurant | Cafe | Fast food | Food delivery | Bakery
- Gathering: Group meal | Drinks & desserts | Gathering activity
- Groceries: Supermarket | Convenience store | Wet market
- Gift: Gift | Red packet
- Bills: Phone | Internet | Utilities | Car | Insurance
- Subscription: App | AI | Learning | Streaming | News | Gym Membership
- Personal Expense: Daily essentials | Leisure clothing | Work clothing | Makeup | Skincare | Accessories | Health & supplements | Beauty treatments | Leisure activities | Learning & development | Electronics | Home
- Travel Expense: Flights | Accommodation | Trip transport | Trip meals | Trip activities
Respond ONLY with valid JSON: {"category":"...","subcategory":"..."} or {"category":null} if completely unknown.`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 80 },
          }),
          signal: AbortSignal.timeout(2800),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const textOut: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const jsonMatch = textOut.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (typeof parsed.category === "string" && parsed.category) {
            return {
              category: parsed.category,
              subcategory: typeof parsed.subcategory === "string" ? parsed.subcategory : undefined,
              isKeywordFallback: false,
            };
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  try {
    const query = `${cleaned} Hong Kong`;
    const [ddgText, osmText] = await Promise.all([
      fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language": "en-HK,en;q=0.9,zh-HK;q=0.8",
        },
        signal: AbortSignal.timeout(2500),
      })
        .then((r) => (r.ok ? r.text() : ""))
        .then((html) =>
          html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .slice(0, 12000),
        )
        .catch(() => ""),
      fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=hk&limit=3&q=${encodeURIComponent(cleaned)}`,
        {
          headers: { "User-Agent": "TallyExpenseTracker/1.0 (HK)" },
          signal: AbortSignal.timeout(2200),
        },
      )
        .then((r) => (r.ok ? r.json() : []))
        .then((arr: Array<{ category?: string; type?: string; display_name?: string }>) =>
          Array.isArray(arr)
            ? arr.map((item) => `${item.category ?? ""} ${item.type ?? ""} ${item.display_name ?? ""}`).join(" ")
            : "",
        )
        .catch(() => ""),
    ]);

    const combinedWebText = `${ddgText} ${osmText}`.trim();
    if (combinedWebText) {
      const scored = scoreWebTextForCategory(combinedWebText);
      if (scored) return scored;
    }
  } catch {
    // Non-fatal fallback
  }

  return local;
}

/**
 * Ingests a notification record into the Tally database.
 * Self-contained with zero fragile cross-file export dependencies so Vercel builds always succeed.
 */
export async function ingestNotificationRecord(
  db: Db,
  input: {
    text?: string;
    parsed?: ParsedNotification;
    channel?: Channel;
    occurredAt?: Date;
    batchId?: string;
  },
): Promise<IngestResult> {
  const parsed = input.parsed ?? (input.text ? parseNotification(input.text) : null);

  if (!parsed) {
    return {
      ok: false,
      message: "No expense transaction found in text.",
    };
  }

  parsed.merchant = cleanOcrMerchantName(parsed.merchant) || parsed.merchant;
  parsed.merchantNormalized = normalizeMerchant(parsed.merchant);

  if (parsed.type === "top_up" || isTopUpLine(parsed.merchant) || isBalanceLine(parsed.merchant)) {
    return {
      ok: true,
      isDuplicate: true,
      message: "Skipped top-up or balance line.",
    };
  }

  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const occurredAt = input.occurredAt ?? parsed.occurredAt ?? new Date();
  const channel = input.channel ?? "shortcut";

  // 1. Resolve payment source
  let source = await db.paymentSource.findFirst({
    where: {
      OR: [{ name: parsed.sourceName }, { kind: parsed.sourceKind }],
    },
  });

  if (!source) {
    source = await db.paymentSource.findFirst({ where: { kind: "credit_card" } });
  }
  if (!source) {
    source = await db.paymentSource.create({
      data: {
        name: parsed.sourceName,
        kind: parsed.sourceKind,
        color: "gray",
      },
    });
  }

  // 2. Resolve MerchantRule, Local Rules, Web Search Discovery, or Keyword Suggestion Fallback
  const rules = await db.merchantRule.findMany({
    orderBy: { hits: "desc" },
    include: { category: true, purpose: true },
  });

  const matchedRule = rules.find((r) => doesMerchantMatchRule(parsed.merchant, r.pattern));

  let categoryId: string | null = matchedRule?.category?.parentId ?? matchedRule?.categoryId ?? null;
  let subcategoryId: string | null = matchedRule?.category?.parentId ? matchedRule.categoryId : null;
  const purposeId: string | null = matchedRule?.purposeId ?? null;

  let hint = classifyMerchant(parsed.merchant) as ExtendedClassification | null;
  let learnedFromWebSearch = false;

  if (
    !categoryId &&
    (!hint || hint.isKeywordFallback) &&
    !parsed.isPersonToPerson &&
    !isGenericWalletMerchant(parsed.merchant)
  ) {
    const webOrKeyword = await searchAndClassifyMerchant(parsed.merchant);
    if (webOrKeyword) {
      if (!webOrKeyword.isKeywordFallback) {
        learnedFromWebSearch = true;
      }
      hint = webOrKeyword;
    }
  }

  if (!categoryId) {
    const categories = await db.category.findMany({ where: { archived: false } });
    if (parsed.isPersonToPerson) {
      const transferCat = categories.find(
        (c) => c.name === (parsed.type === "income" ? "Money Received" : "Transfers to People"),
      );
      if (transferCat) categoryId = transferCat.id;
    } else {
      const parent = hint && categories.find((c) => c.name === hint.category && !c.parentId);
      if (parent) categoryId = parent.id;
    }
  }

  const category = categoryId ? await db.category.findUnique({ where: { id: categoryId } }) : null;

  if (!subcategoryId && hint?.category === category?.name && hint?.subcategory) {
    const child = await db.category.findFirst({
      where: { parentId: categoryId, name: hint.subcategory, archived: false },
    });
    subcategoryId = child?.id ?? null;
  }

  if (learnedFromWebSearch && !hint?.isKeywordFallback && (subcategoryId || categoryId)) {
    const cleanPattern = cleanMerchantForSearch(parsed.merchant).toLowerCase().trim();
    if (cleanPattern.length >= 3) {
      const existingRule = rules.find((r) => doesMerchantMatchRule(cleanPattern, r.pattern));
      if (!existingRule) {
        await db.merchantRule
          .create({
            data: {
              pattern: cleanPattern,
              matchType: "contains",
              categoryId: subcategoryId ?? categoryId,
              sourceKind: parsed.sourceKind,
              hits: 1,
              lastUsedAt: new Date(),
              isDemo: false,
            },
          })
          .catch(() => null);
      }
    }
  }

  const isKeywordSuggestionOnly = !matchedRule && !!hint?.isKeywordFallback;

  const baseReview = decideReview({
    amountMinor: parsed.amountMinor,
    type: parsed.type,
    categoryAmbiguous: category ? category.ambiguous : null,
    hasRulePurpose: !!(matchedRule?.categoryId || matchedRule?.purposeId || learnedFromWebSearch),
    isPersonToPerson: parsed.isPersonToPerson,
    reviewThresholdMinor: settings.reviewThresholdMinor,
  });

  const review = isKeywordSuggestionOnly
    ? {
        status: "needs_review" as const,
        reasons: Array.from(new Set([...baseReview.reasons, "Suggested from keyword — please confirm or change"])),
      }
    : baseReview;

  // 3. Smart Deduplication & Octopus App Source-of-Truth Reconciliation
  const dayStr = formatInZone(occurredAt, "yyyy-MM-dd", settings.timezone);
  const minuteStr = formatInZone(occurredAt, "yyyy-MM-dd'T'HH:mm", settings.timezone);
  const fingerprint = `auto:${shortHash(`${source.id}|${minuteStr}|${parsed.amountMinor}|${parsed.merchantNormalized}`)}`;

  const startOfDay = dayStart(occurredAt, settings.timezone);
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
  const minuteStart = new Date(Math.floor(occurredAt.getTime() / 60_000) * 60_000);
  const minuteEnd = new Date(minuteStart.getTime() + 59_999);

  const exactMinuteMatch = await db.transaction.findFirst({
    where: {
      sourceId: source.id,
      amountMinor: parsed.amountMinor,
      isDemo: false,
      occurredAt: { gte: minuteStart, lte: minuteEnd },
    },
  });

  if (exactMinuteMatch) {
    if (
      parsed.isAuthoritativeSource &&
      !isGenericWalletMerchant(parsed.merchant) &&
      (isGenericWalletMerchant(exactMinuteMatch.merchant) ||
        exactMinuteMatch.merchantNormalized !== parsed.merchantNormalized ||
        !exactMinuteMatch.categoryId)
    ) {
      const updated = await db.transaction.update({
        where: { id: exactMinuteMatch.id },
        data: {
          merchant: parsed.merchant,
          merchantNormalized: parsed.merchantNormalized,
          categoryId: categoryId ?? exactMinuteMatch.categoryId,
          subcategoryId: subcategoryId ?? exactMinuteMatch.subcategoryId,
          datePrecision: "minute",
          purposeStatus:
            exactMinuteMatch.purposeStatus === "confirmed" ? "confirmed" : review.status,
          reviewReasons:
            exactMinuteMatch.purposeStatus === "confirmed" ? "[]" : JSON.stringify(review.reasons),
          rawText: parsed.rawText,
          fingerprint,
          ...(input.batchId ? { importBatchId: input.batchId } : {}),
        },
      });
      return {
        ok: true,
        isDuplicate: false,
        updated: true,
        transactionId: updated.id,
        merchant: updated.merchant,
        amountFormatted: formatMoney(updated.amountMinor, settings.currency),
        categoryName: category?.name ?? "Uncategorized",
        purposeStatus: updated.purposeStatus,
        message: `Updated to Octopus App merchant (${minuteStr}): ${formatMoney(updated.amountMinor, settings.currency)} at ${updated.merchant}`,
      };
    }

    return {
      ok: true,
      isDuplicate: true,
      transactionId: exactMinuteMatch.id,
      merchant: exactMinuteMatch.merchant,
      amountFormatted: formatMoney(exactMinuteMatch.amountMinor, settings.currency),
      message: `Duplicate skipped (${minuteStr}): ${formatMoney(exactMinuteMatch.amountMinor, settings.currency)} at ${exactMinuteMatch.merchant} was already recorded.`,
    };
  }

  if (parsed.isAuthoritativeSource && parsed.sourceKind === "octopus") {
    const existingWalletRow = await db.transaction.findFirst({
      where: {
        sourceId: source.id,
        amountMinor: parsed.amountMinor,
        isDemo: false,
        occurredAt: { gte: startOfDay, lt: endOfDay },
        ...(input.batchId ? { NOT: { importBatchId: input.batchId } } : {}),
        OR: [
          { datePrecision: { not: "minute" } },
          { merchantNormalized: { in: GENERIC_WALLET_MERCHANTS } },
        ],
      },
      orderBy: { occurredAt: "asc" },
    });

    if (existingWalletRow) {
      const updated = await db.transaction.update({
        where: { id: existingWalletRow.id },
        data: {
          occurredAt,
          datePrecision: "minute",
          merchant: parsed.merchant,
          merchantNormalized: parsed.merchantNormalized,
          categoryId: categoryId ?? existingWalletRow.categoryId,
          subcategoryId: subcategoryId ?? existingWalletRow.subcategoryId,
          purposeStatus:
            existingWalletRow.purposeStatus === "confirmed" ? "confirmed" : review.status,
          reviewReasons:
            existingWalletRow.purposeStatus === "confirmed" ? "[]" : JSON.stringify(review.reasons),
          rawText: parsed.rawText,
          fingerprint,
          parseConfidence: parsed.confidence,
          ...(input.batchId ? { importBatchId: input.batchId } : {}),
        },
      });
      return {
        ok: true,
        isDuplicate: false,
        updated: true,
        transactionId: updated.id,
        merchant: updated.merchant,
        amountFormatted: formatMoney(updated.amountMinor, settings.currency),
        categoryName: category?.name ?? "Uncategorized",
        purposeStatus: updated.purposeStatus,
        message: `Matched & upgraded Wallet transaction to Octopus App (${minuteStr}): ${formatMoney(updated.amountMinor, settings.currency)} at ${updated.merchant}`,
      };
    }
  }

  if (!parsed.isAuthoritativeSource || parsed.datePrecision !== "minute") {
    const sameDayExisting = await db.transaction.findFirst({
      where: {
        sourceId: source.id,
        amountMinor: parsed.amountMinor,
        isDemo: false,
        occurredAt: { gte: startOfDay, lt: endOfDay },
        ...(input.batchId ? { NOT: { importBatchId: input.batchId } } : {}),
        OR: [
          ...(parsed.balanceAfterMinor !== undefined
            ? [{ balanceAfterMinor: parsed.balanceAfterMinor }]
            : []),
          { merchantNormalized: parsed.merchantNormalized },
          ...(parsed.sourceKind === "octopus" &&
          (isGenericWalletMerchant(parsed.merchant) || parsed.datePrecision !== "minute")
            ? [{ sourceId: source.id }]
            : []),
        ],
      },
    });

    if (sameDayExisting) {
      return {
        ok: true,
        isDuplicate: true,
        transactionId: sameDayExisting.id,
        merchant: sameDayExisting.merchant,
        amountFormatted: formatMoney(sameDayExisting.amountMinor, settings.currency),
        message: `Duplicate skipped (${dayStr}): ${formatMoney(sameDayExisting.amountMinor, settings.currency)} at ${sameDayExisting.merchant} was already recorded.`,
      };
    }
  }

  let batchId = input.batchId;
  if (!batchId) {
    const batch = await db.importBatch.create({
      data: {
        channel,
        sourceHint: `iPhone 14 Pro (${source.name})`,
        capturedAt: new Date(),
        added: 1,
        needsReview: review.status === "needs_review" ? 1 : 0,
      },
    });
    batchId = batch.id;
  }

  const created = await db.transaction.create({
    data: {
      occurredAt,
      datePrecision: parsed.datePrecision,
      amountMinor: parsed.amountMinor,
      currency: settings.currency,
      merchant: parsed.merchant,
      merchantNormalized: parsed.merchantNormalized,
      counterparty: parsed.counterparty ?? null,
      description: parsed.description ?? null,
      location: parsed.location ?? null,
      categoryId,
      subcategoryId,
      sourceId: source.id,
      channel,
      type: parsed.type,
      purposeId,
      purposeStatus: review.status,
      reviewReasons: JSON.stringify(review.reasons),
      balanceAfterMinor: parsed.balanceAfterMinor ?? null,
      rawText: parsed.rawText,
      fingerprint,
      parseConfidence: parsed.confidence,
      importBatchId: batchId,
      isDemo: false,
    },
  });

  if (matchedRule) {
    await db.merchantRule.update({
      where: { id: matchedRule.id },
      data: { hits: { increment: 1 }, lastUsedAt: new Date() },
    });
  }

  if (parsed.rawText) {
    await db.rawCapture.create({
      data: {
        importBatchId: batchId,
        kind: "text",
        text: parsed.rawText,
        ocrConfidence: parsed.confidence,
        capturedAt: occurredAt,
      },
    });
  }

  await db.settings.update({
    where: { id: 1 },
    data: { lastImportAt: new Date() },
  });

  const amountFormatted = formatMoney(created.amountMinor, settings.currency);
  const categoryName = category?.name ?? "Uncategorized";

  return {
    ok: true,
    isDuplicate: false,
    transactionId: created.id,
    merchant: created.merchant,
    amountFormatted,
    categoryName,
    purposeStatus: created.purposeStatus,
    message:
      created.purposeStatus === "needs_review"
        ? `Logged ${amountFormatted} at ${created.merchant} (Added to To Confirm)`
        : `Logged ${amountFormatted} at ${created.merchant} (${categoryName})`,
  };
}
