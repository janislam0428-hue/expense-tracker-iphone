// Zero-credit on-device/local notification parser.
// Designed for iPhone 14 Pro notification pop-outs (Wallet, Octopus, PayMe, bank SMS/alerts),
// Lock Screen / Notification Center stacks, and Apple Wallet / Octopus App history screenshots.
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
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
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
 * Checks whether a line is a balance statement (e.g. "Your new balance is HK$133.60.")
 * so it is NEVER mistaken for a spending transaction.
 */
export function isBalanceLine(line: string): boolean {
  return /\b(?:your new balance|new balance|remaining balance|available balance|account balance|balance is|balance:|餘額|結餘)\b/i.test(
    line,
  );
}

/**
 * Extracts balance in minor units from a balance line if present.
 */
function extractBalanceMinor(line: string): number | undefined {
  if (!isBalanceLine(line)) return undefined;
  const m = line.match(/(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (!m) return undefined;
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
}

/**
 * Resolves a relative timestamp or weekday label ("Thu 18:56", "15:33", "1h ago", "Thursday", "Today", "Yesterday")
 * to the most recent matching date in Hong Kong time.
 */
export function resolveRelativeDay(
  label: string | null | undefined,
  refDate = new Date(),
  itemIndex = 0,
): { date: Date; precision: DatePrecision } {
  if (!label) return { date: new Date(refDate.getTime() - itemIndex * 1000), precision: "minute" };
  const clean = label.trim().toLowerCase();
  const p = zonedParts(refDate);
  const minuteOffset = Math.max(0, 59 - itemIndex);

  // 1. Relative offset: "1h ago", "2 hr ago", "15m ago", "30 min ago"
  const agoMatch = clean.match(/^(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*ago$/i);
  if (agoMatch) {
    const val = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2].startsWith("h") ? 3600_000 : 60_000;
    return { date: new Date(refDate.getTime() - val * unit - itemIndex * 1000), precision: "minute" };
  }

  // 2. Weekday + HH:mm (e.g. "Thu 18:56", "Wed 22:34", "Yesterday 14:20", "Today 09:15")
  const dayTimeMatch = clean.match(
    /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|今日|昨日|週[一二三四五六日]|星期[一二三四五六日])\s+(\d{1,2}):(\d{2})$/i,
  );
  if (dayTimeMatch) {
    const dayToken = dayTimeMatch[1].toLowerCase();
    const hour = parseInt(dayTimeMatch[2], 10);
    const minute = parseInt(dayTimeMatch[3], 10);
    if (dayToken === "today" || dayToken === "今日") {
      return { date: zonedDate(p.year, p.month, p.day, hour, minute), precision: "minute" };
    }
    if (dayToken === "yesterday" || dayToken === "昨日") {
      const base = addZonedDays(zonedDate(p.year, p.month, p.day, hour, minute), -1);
      return { date: base, precision: "minute" };
    }
    const targetDow = WEEKDAY_INDEX[dayToken];
    if (targetDow !== undefined) {
      const diff = (p.weekday - targetDow + 7) % 7;
      const resolved = addZonedDays(zonedDate(p.year, p.month, p.day, hour, minute), -diff);
      return { date: resolved, precision: "minute" };
    }
  }

  // 3. Time only: "15:33", "09:12" -> Today at HH:mm
  const timeOnlyMatch = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const hour = parseInt(timeOnlyMatch[1], 10);
    const minute = parseInt(timeOnlyMatch[2], 10);
    return { date: zonedDate(p.year, p.month, p.day, hour, minute), precision: "minute" };
  }

  // 4. "Today" / "Yesterday"
  if (clean === "today" || clean === "今日" || clean === "今天") {
    return { date: new Date(refDate.getTime() - itemIndex * 60_000), precision: "date_only" };
  }
  if (clean === "yesterday" || clean === "昨日" || clean === "昨天") {
    const yest = addZonedDays(zonedDate(p.year, p.month, p.day, 12, minuteOffset), -1);
    return { date: yest, precision: "date_only" };
  }

  // 5. Standalone weekday ("Thursday", "Wed")
  const targetDow = WEEKDAY_INDEX[clean];
  if (targetDow !== undefined) {
    const diff = (p.weekday - targetDow + 7) % 7;
    if (diff === 0) {
      return { date: new Date(refDate.getTime() - itemIndex * 60_000), precision: "inferred_weekday" };
    }
    const resolved = addZonedDays(zonedDate(p.year, p.month, p.day, 12, minuteOffset), -diff);
    return { date: resolved, precision: "inferred_weekday" };
  }

  return { date: new Date(refDate.getTime() - itemIndex * 1000), precision: "minute" };
}

/**
 * Parses an individual single-line notification string into structured transaction data.
 */
export function parseNotification(text: string, refDate = new Date()): ParsedNotification | null {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (t.length < 3) return null;

  // Never parse a balance-only line as a transaction
  if (isBalanceLine(t) && !/(?:Paid|Spent|扣除|增值|for\s+Bus|for\s+Train|Purchase)/i.test(t)) {
    return null;
  }

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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.99,
      rawText: t,
    };
  }

  // 2. Octopus English Top-up
  if ((m = t.match(/Octopus:?\s*(?:Top-up|Add value|Reload|Auto top-up)\s*(?:of\s*)?\+?HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const balMatch = t.match(/(?:Remaining|Balance|new balance is)\s*(?:balance\s*)?HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.99,
      rawText: t,
    };
  }

  // 3. Apple Wallet Lock Screen Octopus format:
  //    "HK$8.70 for Bus" / "HK$4.40 for Train" / "HK$20.00 Purchase" / "Octopus HK$8.70 for Bus"
  if (
    (m = t.match(
      /^(?:Octopus[:\s]*)?(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s+(?:for\s+([A-Za-z0-9 &/-]+)|(Purchase|零售|消費|付款))(?:\.|$)/i,
    ))
  ) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const forTarget = m[2]?.trim();
    const isGenericPurchase = !!m[3];
    const merchant = forTarget || (isGenericPurchase ? "Octopus Purchase" : "Octopus");
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      subcategoryHint: forTarget,
      type: "expense",
      sourceName: "Octopus",
      sourceKind: "octopus",
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.98,
      rawText: t,
    };
  }

  // 4. Octopus Chinese Spend (e.g. "八達通: 於九巴扣除 HK$8.70。餘額 HK$350.20")
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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.98,
      rawText: t,
    };
  }

  // 5. Octopus English Spend (e.g. "Octopus: Paid HK$8.70 at KMB Bus. Remaining balance HK$350.20")
  if ((m = t.match(/Octopus:?\s*(?:Paid|Payment of|Spent|-)?\s*HK\$?([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|for)\s*([^.·\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].trim();
    const balMatch = t.match(/(?:Remaining|Balance|new balance is)\s*(?:balance\s*)?HK\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: "Octopus",
      sourceKind: "octopus",
      balanceAfterMinor: balMatch ? Math.round(parseFloat(balMatch[1].replace(/,/g, "")) * 100) : undefined,
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.98,
      rawText: t,
    };
  }

  // 6a. Apple Pay / Wallet with card AND merchant: "You paid HK$350.00 at UNIQLO with Hang Seng Card."
  if ((m = t.match(/(?:You paid|Paid|Spent|Payment of)\s*(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|for)\s*([^.·\n]+?)\s+with\s+([^.]+?)(?:\.|$)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].trim();
    const card = m[3].trim();
    const isOct = card.toLowerCase().includes("octopus") || card.includes("八達通");
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: isOct ? "Octopus" : card.includes("Hang Seng") ? "Hang Seng Card" : card,
      sourceKind: isOct ? "octopus" : "credit_card",
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 6b. Apple Pay / Wallet without merchant (when iOS omits Merchant in Shortcuts): "You paid HK$8.20 with Octopus"
  if ((m = t.match(/(?:You paid|Paid|Spent|Payment of)?\s*(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s+with\s+([^.·\n]+?)(?:\.|$)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const card = m[2].trim();
    const isOct = card.toLowerCase().includes("octopus") || card.includes("八達通");
    const merchant = isOct ? "Octopus Purchase" : `${card} Purchase`;
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: isOct ? "Octopus" : card.includes("Hang Seng") ? "Hang Seng Card" : card,
      sourceKind: isOct ? "octopus" : "credit_card",
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.94,
      rawText: t,
    };
  }

  // 7. PayMe Notifications (P2P and merchants)
  // 7a. PayMe: Merchant before amount (e.g. "You've paid Karen Chan HK$150.00" / "已付款給 Karen Chan HK$150.00")
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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: isP2P,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 7b. PayMe: Amount before merchant (e.g. "You've paid HK$150.00 to Karen Chan" / "已付款 HK$150.00 給 Karen Chan")
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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: isP2P,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 7c. PayMe Received: "Karen Chan sent you HK$200.00" / "Karen Chan 已向你轉賬 HK$200.00"
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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: true,
      confidence: 0.95,
      rawText: t,
    };
  }

  // 8. Bank & Credit Card Notifications (HSBC, Hang Seng, Standard Chartered, Mox, ZA, Citi, BOC, DBS)
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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.92,
      rawText: t,
    };
  }

  // 9. Amount with destination: "HK$8.70 at KMB" / "HK$150.00 to Karen" / "$45 at Starbucks"
  if ((m = t.match(/(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|for|於|給)\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].replace(/\s+(?:on|with).*$/, "").trim();
    const isOctopusTransit = /^(?:bus|train|mtr|transit|minibus|ferry|tram|light rail)$/i.test(merchant);
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      subcategoryHint: isOctopusTransit ? merchant : undefined,
      type: "expense",
      sourceName: isOctopusTransit ? "Octopus" : "Hang Seng Card",
      sourceKind: isOctopusTransit ? "octopus" : "credit_card",
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.9,
      rawText: t,
    };
  }

  // 10. General Smart Fallback Pattern
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
      occurredAt: refDate,
      datePrecision: "minute",
      isPersonToPerson: false,
      confidence: 0.82,
      rawText: t,
    };
  }

  return null;
}

const TIMESTAMP_LINE_REGEX =
  /^(?:(\d+)\s*(?:h|hr|hrs|m|min|mins)\s*ago|(?:(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Yesterday|今日|昨日|週[一二三四五六日]|星期[一二三四五六日])\s+)?\d{1,2}:\d{2}|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Yesterday|今日|昨日|週[一二三四五六日]|星期[一二三四五六日])$/i;

const HEADER_WITH_TIMESTAMP_REGEX =
  /^(?:Octopus|Wallet|Apple Pay|PayMe)\s+((?:\d+\s*(?:h|hr|hrs|m|min|mins)\s*ago|(?:(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Yesterday)\s+)?\d{1,2}:\d{2}))$/i;

/**
 * Parses an Apple Wallet Lock Screen notification stack or "Latest Transactions" history screenshot.
 * Specifically ignores "Your new balance is HK$..." lines as standalone transactions
 * (attaching them as balanceAfterMinor instead), and parses "HK$8.70 for Bus" & "HK$20.00 Purchase".
 */
export function parseWalletHistoryList(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[>›»]/g, "").trim())
    .filter((l) => l.length > 0);

  const noise =
    /^(?:\d{1,2}:\d{2}|wallet|show less|clear|clear all|tap and go|hold iphone|without double|latest transactions|express mode|octopus|card|cards|done|back|x|×)$/i;

  const transportSubRegex = /^(Bus|Train|Transit|Minibus|Ferry|Tram|Light Rail|巴士|九巴|港鐵|電車|小巴|渡輪)$/i;

  const items: ParsedNotification[] = [];
  let pendingTimestampLabel: string | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // 1. Check if this line is a balance statement (e.g. "Your new balance is HK$11.00.")
    if (isBalanceLine(line)) {
      const balMinor = extractBalanceMinor(line);
      if (balMinor !== undefined && items.length > 0 && items[items.length - 1].balanceAfterMinor === undefined) {
        items[items.length - 1].balanceAfterMinor = balMinor;
      }
      continue;
    }

    // 2. Check if this line is a header with a timestamp (e.g. "Octopus 1h ago" or "Octopus Thu 18:56")
    const headerTs = line.match(HEADER_WITH_TIMESTAMP_REGEX);
    if (headerTs) {
      pendingTimestampLabel = headerTs[1].trim();
      continue;
    }

    // 3. Check if this line is a standalone relative timestamp/weekday (e.g. "1h ago", "15:33", "Thu 18:56", "Wednesday")
    if (TIMESTAMP_LINE_REGEX.test(line)) {
      if (i > 0 || !/^\d{1,2}:\d{2}$/.test(line)) {
        pendingTimestampLabel = line;
      }
      continue;
    }

    if (noise.test(line)) continue;

    // 4. First check if the line itself is a complete single-line notification (e.g. "HK$8.70 for Bus" or "HK$20.00 Purchase")
    const directSingle = parseNotification(line, refDate);
    if (directSingle) {
      let tsLabel = pendingTimestampLabel;
      if (!tsLabel && i + 1 < rawLines.length && TIMESTAMP_LINE_REGEX.test(rawLines[i + 1])) {
        tsLabel = rawLines[i + 1];
      }
      const resolved = resolveRelativeDay(tsLabel, refDate, items.length);
      directSingle.occurredAt = resolved.date;
      directSingle.datePrecision = resolved.precision;
      if (tsLabel) {
        directSingle.rawText = `${tsLabel} · ${directSingle.rawText}`;
      }
      items.push(directSingle);
      pendingTimestampLabel = null;
      continue;
    }

    // 5. Otherwise check for Apple Wallet "Latest Transactions" multi-line layout
    const amtMatch = line.match(/([+-]?)\s*(?:HKD|HK\$|\$)\s*([0-9,]+\.[0-9]{1,2})/i);
    if (!amtMatch) continue;

    const sign = amtMatch[1];
    const amountMinor = Math.round(parseFloat(amtMatch[2].replace(/,/g, "")) * 100);
    if (amountMinor <= 0) continue;

    const prefixText = line.slice(0, amtMatch.index).replace(/[-–—:]+$/, "").trim();
    const suffixText = line
      .slice((amtMatch.index ?? 0) + amtMatch[0].length)
      .replace(/^[.\s-–—:]+|[.\s]+$/g, "")
      .trim();

    let title = prefixText;
    let subtitle: string | null = null;
    let dayLabel: string | null = pendingTimestampLabel;

    // Check if suffix after amount specifies "for Bus" / "Purchase"
    if (!title && suffixText) {
      const forMatch = suffixText.match(/^(?:for\s+)?([A-Za-z0-9 &/-]+)$/i);
      if (forMatch) {
        const cleanSuffix = forMatch[1].trim();
        if (/^purchase$/i.test(cleanSuffix)) {
          title = "Octopus Purchase";
        } else {
          title = cleanSuffix;
          if (transportSubRegex.test(cleanSuffix)) subtitle = cleanSuffix;
        }
      }
    }

    if (title) {
      for (let j = i + 1; j <= Math.min(rawLines.length - 1, i + 2); j++) {
        const nextLine = rawLines[j];
        if (isBalanceLine(nextLine)) continue;
        if (/([+-]?)\s*(?:HKD|HK\$|\$)\s*[0-9,]+\.[0-9]{1,2}/i.test(nextLine)) break;
        if (transportSubRegex.test(nextLine) && !subtitle) subtitle = nextLine;
        else if (TIMESTAMP_LINE_REGEX.test(nextLine) && !dayLabel) dayLabel = nextLine;
      }
    } else {
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const prevLine = rawLines[j];
        if (isBalanceLine(prevLine) || noise.test(prevLine) || HEADER_WITH_TIMESTAMP_REGEX.test(prevLine)) continue;
        if (/([+-]?)\s*(?:HKD|HK\$|\$)\s*[0-9,]+\.[0-9]{1,2}/i.test(prevLine)) break;
        if (TIMESTAMP_LINE_REGEX.test(prevLine)) {
          if (!dayLabel) dayLabel = prevLine;
        } else if (transportSubRegex.test(prevLine) && !subtitle) {
          subtitle = prevLine;
        } else if (!title) {
          title = prevLine;
        }
      }
    }

    let merchant = title || subtitle || "Octopus";
    let location: string | undefined = undefined;
    let subcategoryHint: string | undefined = undefined;

    if (subtitle && title && title.toLowerCase() !== subtitle.toLowerCase()) {
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
    pendingTimestampLabel = null;
  }

  return items;
}

/**
 * Parses multi-line text (from Notification Center, Apple Wallet history screenshots, or batch paste).
 */
export function parseMultipleNotifications(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];

  const historyItems = parseWalletHistoryList(text, refDate);
  if (historyItems.length > 0) {
    return historyItems;
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !isBalanceLine(l));
  const results: ParsedNotification[] = [];

  for (const line of lines) {
    const parsed = parseNotification(line, refDate);
    if (parsed) {
      results.push(parsed);
    }
  }

  if (results.length > 0) {
    return results;
  }

  const single = parseNotification(text, refDate);
  if (single) results.push(single);

  return results;
}
