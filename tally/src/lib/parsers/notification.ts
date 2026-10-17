// Zero-credit on-device/local notification parser.
// Designed for iPhone 14 Pro notification pop-outs (Wallet, Octopus, PayMe, bank SMS/alerts)
// and Apple Wallet / Octopus App transaction history screenshots.
// Runs in <1ms without any LLM API calls, completely eliminating API token/credit costs.

import { normalizeMerchant } from "@/lib/text";
import { addZonedDays, zonedDate, zonedParts } from "@/lib/time";
import type { DatePrecision, SourceKind, TransactionType } from "@/lib/domain";

export type ParsedNotification = {
  amountMinor: number;
  currency: string;
  merchant: string;
  merchantNormalized: string;
  counterparty?: string;
  description?: string;
  location?: string;
  subcategoryHint?: string;
  type: TransactionType;
  sourceName: string;
  sourceKind: SourceKind;
  balanceAfterMinor?: number;
  occurredAt?: Date;
  datePrecision: DatePrecision;
  isPersonToPerson: boolean;
  confidence: number;
  rawText: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  週日: 0,
  星期日: 0,
  週一: 1,
  星期一: 1,
  週二: 2,
  星期二: 2,
  週三: 3,
  星期三: 3,
  週四: 4,
  星期四: 4,
  週五: 5,
  星期五: 5,
  週六: 6,
  星期六: 6,
};

/**
 * Resolves a relative weekday label ("Thursday", "Wednesday", "Today", "Yesterday")
 * to the most recent matching date in Hong Kong time.
 */
export function resolveRelativeDay(
  label: string | null | undefined,
  refDate = new Date(),
   itemIndex = 0,
): { date: Date; precision: DatePrecision } {
  if (!label) return { date: refDate, precision: "minute" };
  const clean = label.trim().toLowerCase();
  const p = zonedParts(refDate);
  // Offset minutes slightly by itemIndex so multiple items on the same day maintain screenshot order
  const minuteOffset = Math.max(0, 59 - itemIndex);

  if (clean === "today" || clean === "今日" || clean === "今天") {
    return { date: zonedDate(p.year, p.month, p.day, 12, minuteOffset), precision: "date_only" };
  }
  if (clean === "yesterday" || clean === "昨日" || clean === "昨天") {
    const yest = addZonedDays(zonedDate(p.year, p.month, p.day, 12, minuteOffset), -1);
    return { date: yest, precision: "date_only" };
  }

  const targetDow = WEEKDAY_INDEX[clean];
  if (targetDow !== undefined) {
    let diff = (p.weekday - targetDow + 7) % 7;
    if (diff === 0) diff = 0; // Same weekday means today or 7 days ago
    const resolved = addZonedDays(zonedDate(p.year, p.month, p.day, 12, minuteOffset), -diff);
    return { date: resolved, precision: "inferred_weekday" };
  }

  return { date: refDate, precision: "minute" };
}

/**
 * Parses an individual single-line notification string into structured transaction data.
 */
export function parseNotification(text: string): ParsedNotification | null {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (t.length < 3) return null;

  let m: RegExpMatchArray | null;

  // 1. Octopus Chinese Top-up
  if ((m = t.match(/八達通[:：]?\s*(?:增值|自動增值)\s*HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const balMatch = t.match(/餘額\s*HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
    return {
      amountMinor,
      currency: "HKD",
      merchant: "Octopus top up",
      merchantNormalized: "octopus top up",
      description: "Top up",
      type: "top_up",
      sourceName: "Octopus",
      sourceKind: "octopus",
      balanceAfterMinor: balMatch ? Math.round(parseFloat(balMatch[1].replace(/,/g, "")) * 100) : undefined,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.99,
      rawText: t,
    };
  }

  // 2. Octopus English Top-up
  if ((m = t.match(/Octopus:?\s*(?:Top-up|Add value|Reload|Auto top-up)\s*(?:of\s*)?\+?HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const balMatch = t.match(/(?:Remaining|Balance)\s*(?:balance\s*)?HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
    return {
      amountMinor,
      currency: "HKD",
      merchant: "Octopus top up",
      merchantNormalized: "octopus top up",
      description: "Credit",
      type: "top_up",
      sourceName: "Octopus",
      sourceKind: "octopus",
      balanceAfterMinor: balMatch ? Math.round(parseFloat(balMatch[1].replace(/,/g, "")) * 100) : undefined,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.99,
      rawText: t,
    };
  }

  // 3. Octopus Chinese Spend (e.g. "八達通: 於九巴扣除 HK$8.70。餘額 HK$350.20")
  if ((m = t.match(/八達通[:：]?\s*於\s*([^。，\n]+?)\s*扣除\s*HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i))) {
    const merchant = m[1].trim();
    const amountMinor = Math.round(parseFloat(m[2].replace(/,/g, "")) * 100);
    const balMatch = t.match(/餘額\s*HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: "Octopus",
      sourceKind: "octopus",
      balanceAfterMinor: balMatch ? Math.round(parseFloat(balMatch[1].replace(/,/g, "")) * 100) : undefined,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.98,
      rawText: t,
    };
  }

  // 4. Octopus English Spend (e.g. "Octopus: Paid HK$8.70 at KMB Bus. Remaining balance HK$350.20")
  if ((m = t.match(/Octopus:?\s*(?:Paid|Payment of|Spent|-)?\s*HK\$?([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to)\s*([^.·\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].trim();
    const balMatch = t.match(/(?:Remaining|Balance)\s*(?:balance\s*)?HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: "Octopus",
      sourceKind: "octopus",
      balanceAfterMinor: balMatch ? Math.round(parseFloat(balMatch[1].replace(/,/g, "")) * 100) : undefined,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.98,
      rawText: t,
    };
  }

  // 5. Apple Pay / Wallet with card specified: "You paid HK$350.00 at UNIQLO with Hang Seng Card."
  if ((m = t.match(/(?:You paid|Spent|Payment of)\s*(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to)\s*([^.·\n]+?)\s+with\s+([^.]+?)(?:\.|$)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].trim();
    const card = m[3].trim();
    const isOct = card.toLowerCase().includes("octopus");
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: isOct ? "Octopus" : card.includes("Hang Seng") ? "Hang Seng Card" : card,
      sourceKind: isOct ? "octopus" : "credit_card",
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 6. PayMe Notifications (P2P and merchants)
  // 6a. PayMe: Merchant before amount (e.g. "You've paid Karen Chan HK$150.00" / "已付款給 Karen Chan HK$150.00")
  if ((m = t.match(/(?:You(?:'ve)? paid|paid|已付款|轉賬給|付款給)\s+([^0-9$]+?)\s+(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i))) {
    const target = m[1].replace(/^(?:to|於|給|at)\s+/i, "").trim();
    const amountMinor = Math.round(parseFloat(m[2].replace(/,/g, "")) * 100);
    const isP2P = !/Starbucks|Pacific Coffee|7-Eleven|Circle K|HKTVmall|store|shop|patisserie|café|cafe|bakery/i.test(target);
    return {
      amountMinor,
      currency: "HKD",
      merchant: target,
      merchantNormalized: normalizeMerchant(target),
      counterparty: isP2P ? target : undefined,
      type: "expense",
      sourceName: "PayMe",
      sourceKind: "payme",
      datePrecision: "minute",
      isPersonToPerson: isP2P,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 6b. PayMe: Amount before merchant (e.g. "You've paid HK$150.00 to Karen Chan" / "已付款 HK$150.00 給 Karen Chan")
  if ((m = t.match(/(?:You(?:'ve)? paid|已付款)\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:to|at|給|於)\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const target = m[2].trim();
    const isP2P = !/Starbucks|Pacific Coffee|7-Eleven|Circle K|HKTVmall|store|shop|patisserie|café|cafe|bakery/i.test(target);
    return {
      amountMinor,
      currency: "HKD",
      merchant: target,
      merchantNormalized: normalizeMerchant(target),
      counterparty: isP2P ? target : undefined,
      type: "expense",
      sourceName: "PayMe",
      sourceKind: "payme",
      datePrecision: "minute",
      isPersonToPerson: isP2P,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 6c. PayMe Received: "Karen Chan sent you HK$200.00" / "Karen Chan 已向你轉賬 HK$200.00"
  if ((m = t.match(/([^.。，\n]+?)\s*(?:sent you|已向你轉賬)\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i))) {
    const counterparty = m[1].replace(/PayMe:?/i, "").trim();
    const amountMinor = Math.round(parseFloat(m[2].replace(/,/g, "")) * 100);
    return {
      amountMinor,
      currency: "HKD",
      merchant: counterparty,
      merchantNormalized: normalizeMerchant(counterparty),
      counterparty,
      type: "income",
      sourceName: "PayMe",
      sourceKind: "payme",
      datePrecision: "minute",
      isPersonToPerson: true,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 7. Bank & Credit Card Notifications (HSBC, Hang Seng, Standard Chartered, Mox, ZA, Citi, BOC, DBS)
  if ((m = t.match(/(?:HSBC|Hang Seng|Standard Chartered|Mox|ZA Bank|Citi|BOC|DBS|Credit Card|信用卡)[^:]*:[^0-9]*(?:spent|purchase of|made at|payment of|扣除|簽賬|付款)?\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:was made at|at|to|with Card ending \d+ at|於)\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].replace(/\s+(?:on|with).*$/, "").trim();
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: "Hang Seng Card",
      sourceKind: "credit_card",
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.92,
      rawText: t,
    };
  }

  // 8. Amount with destination: "HK$8.70 at KMB" / "HK$150.00 to Karen" / "$45 at Starbucks"
  if ((m = t.match(/(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|於|給)\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].replace(/\s+(?:on|with).*$/, "").trim();
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: "Hang Seng Card",
      sourceKind: "credit_card",
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.88,
      rawText: t,
    };
  }

  // 9. General Smart Fallback Pattern
  if ((m = t.match(/(?:spent|paid|payment of|簽賬|付款)\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|於)?\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].replace(/\s+(?:on|with).*$/, "").trim();
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: "Hang Seng Card",
      sourceKind: "credit_card",
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.82,
      rawText: t,
    };
  }

  return null;
}

/**
 * Parses an Apple Wallet Octopus history screenshot (like "Latest Transactions" in Wallet).
 * Handles both:
 *  - Row-by-row OCR ("Cheung Sha Wan, Kowloon HK$8.20 >" followed by "Bus" and "Thursday")
 *  - Split-line OCR ("Cheung Sha Wan, Kowloon" / "Bus" / "Thursday" / "HK$8.20")
 */
export function parseWalletHistoryList(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[>›»]/g, "").trim())
    .filter((l) => l.length > 0);

  const noise = /^(?:\d{1,2}:\d{2}|tap and go|hold iphone|without double|latest transactions|express mode|octopus|card|cards|done|back)$/i;
  const lines = rawLines.filter((l) => !noise.test(l));

  const weekdayRegex = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Yesterday|今日|昨日|週[一二三四五六日]|星期[一二三四五六日])$/i;
  const transportSubRegex = /^(Bus|Train|Transit|Minibus|Ferry|Tram|Light Rail|巴士|九巴|港鐵|電車|小巴|渡輪)$/i;

  const items: ParsedNotification[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const amtMatch = line.match(/([+-]?)\s*(?:HKD|HK\$|\$)\s*([0-9,]+\.[0-9]{1,2})/i);
    if (!amtMatch) continue;

    const sign = amtMatch[1];
    const amountMinor = Math.round(parseFloat(amtMatch[2].replace(/,/g, "")) * 100);
    if (amountMinor <= 0) continue;

    const prefixText = line.slice(0, amtMatch.index).replace(/[-–—:]+$/, "").trim();
    let title = prefixText;
    let subtitle: string | null = null;
    let dayLabel: string | null = null;

    if (title) {
      // Amount was on the same line as the title (e.g. "Cheung Sha Wan, Kowloon HK$8.20")
      // Look 1-2 lines ahead for transport type ("Bus") and weekday ("Thursday")
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) {
        const nextLine = lines[j];
        if (/([+-]?)\s*(?:HKD|HK\$|\$)\s*[0-9,]+\.[0-9]{1,2}/i.test(nextLine)) break;
        if (transportSubRegex.test(nextLine) && !subtitle) subtitle = nextLine;
        else if (weekdayRegex.test(nextLine) && !dayLabel) dayLabel = nextLine;
      }
    } else {
      // Amount was on its own line below the title/subtitle/weekday
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const prevLine = lines[j];
        if (/([+-]?)\s*(?:HKD|HK\$|\$)\s*[0-9,]+\.[0-9]{1,2}/i.test(prevLine)) break;
        if (weekdayRegex.test(prevLine) && !dayLabel) dayLabel = prevLine;
        else if (transportSubRegex.test(prevLine) && !subtitle) subtitle = prevLine;
        else if (!title) title = prevLine;
      }
    }

    let merchant = title || subtitle || "Octopus";
    let location: string | undefined = undefined;
    let subcategoryHint: string | undefined = undefined;

    if (subtitle && title && title.toLowerCase() !== subtitle.toLowerCase()) {
      // e.g. title = "Cheung Sha Wan, Kowloon", subtitle = "Bus"
      merchant = subtitle;
      location = title;
      subcategoryHint = subtitle;
    } else if (transportSubRegex.test(merchant)) {
      subcategoryHint = merchant;
    }

    const isTopUp = sign === "+" || /top-?up|credit|reload|增值/i.test(`${title} ${subtitle || ""}`);
    const resolved = resolveRelativeDay(dayLabel, refDate, items.length);

    items.push({
      amountMinor,
      currency: "HKD",
      merchant: isTopUp ? "Octopus top up" : merchant,
      merchantNormalized: normalizeMerchant(isTopUp ? "Octopus top up" : merchant),
      location,
      subcategoryHint,
      type: isTopUp ? "top_up" : "expense",
      sourceName: "Octopus",
      sourceKind: "octopus",
      occurredAt: resolved.date,
      datePrecision: resolved.precision,
      isPersonToPerson: false,
      confidence: 0.94,
      rawText: [title, subtitle, dayLabel, amtMatch[0]].filter(Boolean).join(" · "),
    });
  }

  return items;
}

/**
 * Parses multi-line text (from Notification Center, Apple Wallet history screenshots, or batch paste).
 */
export function parseMultipleNotifications(text: string): ParsedNotification[] {
  if (!text) return [];

  // Check if this looks like an Apple Wallet / Octopus transaction history list
  // (contains multiple HK$ amounts or weekday lines or "Latest Transactions")
  const hkDollarMatches = text.match(/(?:HKD|HK\$|\$)\s*[0-9,]+\.[0-9]{1,2}/gi) ?? [];
  const hasWeekdayLines = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Yesterday)$/im.test(text);

  if (hkDollarMatches.length > 1 || hasWeekdayLines || /latest transactions/i.test(text)) {
    const historyItems = parseWalletHistoryList(text);
    if (historyItems.length > 0) {
      return historyItems;
    }
  }

  // Next check single-line notifications
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 3);
  const results: ParsedNotification[] = [];

  for (const line of lines) {
    const parsed = parseNotification(line);
    if (parsed) {
      results.push(parsed);
    }
  }

  if (results.length > 0) {
    return results;
  }

  // Fallback to history list parser even for single item
  const fallbackHistory = parseWalletHistoryList(text);
  if (fallbackHistory.length > 0) {
    return fallbackHistory;
  }

  const single = parseNotification(text);
  if (single) results.push(single);

  return results;
}
