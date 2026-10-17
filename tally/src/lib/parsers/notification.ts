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

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
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
 * Checks whether a line is a top-up / reload / value-add statement
 * so it is NEVER included in spending transactions.
 */
export function isTopUpLine(line: string): boolean {
  if (/([+])\s*(?:HKD|HK\$|\$)\s*[0-9,]+(?:\.[0-9]{1,2})?/i.test(line)) return true;
  return /\b(?:top-?up|add value|reload|auto top-?up|aav|octopus top up|增值|自動增值)\b/i.test(line);
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
 * Resolves any date, relative weekday, or timestamp label into a concrete Date in Hong Kong time:
 * - Explicit dates (>1 week ago): "2026-10-07", "07/10/2026", "7 Oct 2026", "Oct 7", "10月7日"
 * - Weekdays (within past 7 days): "Tuesday", "Wednesday", "Thu 18:56", "Wed 22:34"
 * - Relative offsets: "1h ago", "25m ago", "Today", "Yesterday", "15:33"
 */
export function resolveRelativeDay(
  label: string | null | undefined,
  refDate = new Date(),
  itemIndex = 0,
): { date: Date; precision: DatePrecision } {
  if (!label) return { date: new Date(refDate.getTime() - itemIndex * 1000), precision: "minute" };
  const raw = label.trim().replace(/^(?:Octopus|Wallet|Apple Pay|PayMe)\s+/i, "").trim();
  const clean = raw.toLowerCase();
  const p = zonedParts(refDate);
  const minuteOffset = Math.max(0, 59 - itemIndex);

  // 1. Explicit ISO date: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD (with optional HH:mm)
  let m = raw.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?:\s*,?\s*(\d{1,2}):(\d{2}))?\b/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    const hasTime = m[4] !== undefined && m[5] !== undefined;
    const hour = hasTime ? parseInt(m[4], 10) : 12;
    const minute = hasTime ? parseInt(m[5], 10) : minuteOffset;
    return {
      date: zonedDate(year, month, day, hour, minute),
      precision: hasTime ? "minute" : "date_only",
    };
  }

  // 2. Explicit DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY (standard Hong Kong date format, >1 week ago)
  m = raw.match(/\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])[/-](20\d{2}|\d{2})(?:\s*,?\s*(\d{1,2}):(\d{2}))?\b/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const yrRaw = parseInt(m[3], 10);
    const year = yrRaw < 100 ? 2000 + yrRaw : yrRaw;
    const hasTime = m[4] !== undefined && m[5] !== undefined;
    const hour = hasTime ? parseInt(m[4], 10) : 12;
    const minute = hasTime ? parseInt(m[5], 10) : minuteOffset;
    return {
      date: zonedDate(year, month, day, hour, minute),
      precision: hasTime ? "minute" : "date_only",
    };
  }

  // 3. Explicit Chinese date: "2026年10月7日" or "10月7日"
  m = raw.match(/(?:(20\d{2})年)?\s*(0?[1-9]|1[0-2])月\s*(0?[1-9]|[12]\d|3[01])[日號]?(?:\s*(\d{1,2}):(\d{2}))?/);
  if (m) {
    const year = m[1] ? parseInt(m[1], 10) : p.year;
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    const hasTime = m[4] !== undefined && m[5] !== undefined;
    const hour = hasTime ? parseInt(m[4], 10) : 12;
    const minute = hasTime ? parseInt(m[5], 10) : minuteOffset;
    return {
      date: zonedDate(year, month, day, hour, minute),
      precision: hasTime ? "minute" : "date_only",
    };
  }

  // 4. Explicit Month Name date: "7 Oct 2026", "7 Oct", "17 Oct, 20:18", "Oct 7, 2026", "Oct 7"
  m =
    raw.match(
      /\b(?:mon|tue|wed|thu|fri|sat|sun)?\s*,?\s*(0?[1-9]|[12]\d|3[01])\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s*,?\s*(20\d{2}))?(?:\s*,?\s*(\d{1,2}):(\d{2}))?\b/i,
    ) ??
    raw.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(0?[1-9]|[12]\d|3[01])(?:\s*,?\s*(20\d{2}))?(?:\s*,?\s*(\d{1,2}):(\d{2}))?\b/i,
    );
  if (m) {
    const isDayFirst = /^\d/.test(m[1]);
    const day = parseInt(isDayFirst ? m[1] : m[2], 10);
    const monStr = (isDayFirst ? m[2] : m[1]).toLowerCase().slice(0, 3);
    const month = MONTH_INDEX[monStr] ?? p.month;
    const year = m[3] ? parseInt(m[3], 10) : p.year;
    const hasTime = m[4] !== undefined && m[5] !== undefined;
    const hour = hasTime ? parseInt(m[4], 10) : 12;
    const minute = hasTime ? parseInt(m[5], 10) : minuteOffset;
    return {
      date: zonedDate(year, month, day, hour, minute),
      precision: hasTime ? "minute" : "date_only",
    };
  }

  // 5. Relative offset: "1h ago", "2 hr ago", "15m ago", "30 min ago"
  const agoMatch = clean.match(/\b(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*ago\b/i);
  if (agoMatch) {
    const val = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2].startsWith("h") ? 3600_000 : 60_000;
    const target = new Date(refDate.getTime() - val * unit);
    const tp = zonedParts(target);
    return { date: zonedDate(tp.year, tp.month, tp.day, tp.hour, tp.minute), precision: "minute" };
  }

  // 6. Weekday + HH:mm (e.g. "Thu 18:56", "Wed 22:34", "Yesterday 14:20", "Today 09:15")
  const dayTimeMatch = clean.match(
    /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|今日|昨日|週[一二三四五六日]|星期[一二三四五六日])\s*,?\s*(\d{1,2}):(\d{2})\b/i,
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
      let diff = (p.weekday - targetDow + 7) % 7;
      // If same weekday but the time is in the future relative to refDate, it was 7 days ago
      if (diff === 0 && (hour > p.hour || (hour === p.hour && minute > p.minute))) {
        diff = 7;
      }
      const resolved = addZonedDays(zonedDate(p.year, p.month, p.day, hour, minute), -diff);
      return { date: resolved, precision: "minute" };
    }
  }

  // 7. Time only: "15:33", "09:12" -> Today at HH:mm
  const timeOnlyMatch = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const hour = parseInt(timeOnlyMatch[1], 10);
    const minute = parseInt(timeOnlyMatch[2], 10);
    return { date: zonedDate(p.year, p.month, p.day, hour, minute), precision: "minute" };
  }

  // 8. "Today" / "Yesterday"
  if (clean === "today" || clean === "今日" || clean === "今天") {
    return { date: zonedDate(p.year, p.month, p.day, 12, minuteOffset), precision: "date_only" };
  }
  if (clean === "yesterday" || clean === "昨日" || clean === "昨天") {
    const yest = addZonedDays(zonedDate(p.year, p.month, p.day, 12, minuteOffset), -1);
    return { date: yest, precision: "date_only" };
  }

  // 9. Standalone weekday ("Tuesday", "Wednesday", "Thursday") -> within the past 7 days
  const targetDow = WEEKDAY_INDEX[clean];
  if (targetDow !== undefined) {
    let diff = (p.weekday - targetDow + 7) % 7;
    // In Apple Wallet, today is labeled "Today"; a weekday name matching today is 7 days ago
    if (diff === 0) diff = 7;
    const resolved = addZonedDays(zonedDate(p.year, p.month, p.day, 12, minuteOffset), -diff);
    return { date: resolved, precision: "inferred_weekday" };
  }

  return { date: new Date(refDate.getTime() - itemIndex * 1000), precision: "minute" };
}

/**
 * Checks if a string is purely a date, weekday, or timestamp (and NOT a merchant name).
 */
export function isDateOrTimestampLabel(text: string): boolean {
  const s = text.trim().replace(/^(?:Octopus|Wallet|Apple Pay|PayMe)\s+/i, "").trim();
  if (!s) return false;
  if (/^\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?:\s*,?\s*\d{1,2}:\d{2})?$/.test(s)) return true;
  if (/^(?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:20\d{2}|\d{2})(?:\s*,?\s*\d{1,2}:\d{2})?$/.test(s))
    return true;
  if (/^(?:20\d{2}年)?\s*(?:0?[1-9]|1[0-2])月\s*(?:0?[1-9]|[12]\d|3[01])[日號]?(?:\s*\d{1,2}:\d{2})?$/.test(s))
    return true;
  if (
    /^(?:(?:mon|tue|wed|thu|fri|sat|sun)\s*,?\s*)?(?:0?[1-9]|[12]\d|3[01])\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s*,?\s*20\d{2})?(?:\s*,?\s*\d{1,2}:\d{2})?$/i.test(
      s,
    )
  )
    return true;
  if (
    /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:0?[1-9]|[12]\d|3[01])(?:\s*,?\s*20\d{2})?(?:\s*,?\s*\d{1,2}:\d{2})?$/i.test(
      s,
    )
  )
    return true;
  if (/^\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*ago$/i.test(s)) return true;
  if (
    /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|今日|今天|昨日|昨天|週[一二三四五六日]|星期[一二三四五六日])(?:\s*,?\s*\d{1,2}:\d{2})?$/i.test(
      s,
    )
  )
    return true;
  if (/^\d{1,2}:\d{2}$/.test(s)) return true;
  return false;
}

/**
 * Extracts any embedded date/time label from a line and returns both the date label and the remaining merchant text.
 */
function splitDateFromText(line: string): { dateLabel: string | null; remainingText: string } {
  const s = line.trim();
  if (isDateOrTimestampLabel(s)) {
    return {
      dateLabel: s.replace(/^(?:Octopus|Wallet|Apple Pay|PayMe)\s+/i, "").trim(),
      remainingText: "",
    };
  }

  const patterns = [
    /\b(20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?:\s*,?\s*\d{1,2}:\d{2})?)\b/i,
    /\b((?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:20\d{2}|\d{2})(?:\s*,?\s*\d{1,2}:\d{2})?)\b/i,
    /((?:20\d{2}年)?\s*(?:0?[1-9]|1[0-2])月\s*(?:0?[1-9]|[12]\d|3[01])[日號]?(?:\s*\d{1,2}:\d{2})?)/i,
    /\b((?:0?[1-9]|[12]\d|3[01])\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s*,?\s*20\d{2})?(?:\s*,?\s*\d{1,2}:\d{2})?)\b/i,
    /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(?:0?[1-9]|[12]\d|3[01])(?:\s*,?\s*20\d{2})?(?:\s*,?\s*\d{1,2}:\d{2})?)\b/i,
    /\b(\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*ago)\b/i,
    /\b((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|今日|今天|昨日|昨天|週[一二三四五六日]|星期[一二三四五六日])\s*,?\s*\d{1,2}:\d{2})\b/i,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|今日|今天|昨日|昨天|週[一二三四五六日]|星期[一二三四五六日])\b/i,
  ];

  for (const pat of patterns) {
    const m = s.match(pat);
    if (m) {
      const dateLabel = m[1].trim();
      const remainingText = s
        .replace(m[0], " ")
        .replace(/^(?:Octopus|Wallet|Apple Pay)\b/i, "")
        .replace(/\s+/g, " ")
        .replace(/^[-–—:·.\s]+|[-–—:·.\s]+$/g, "")
        .trim();
      return { dateLabel, remainingText };
    }
  }

  return { dateLabel: null, remainingText: s };
}

/**
 * Parses an individual single-line notification string into structured transaction data.
 * Top-ups and remaining balance lines are strictly ignored so they never inflate spending totals.
 */
export function parseNotification(text: string, refDate = new Date()): ParsedNotification | null {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (t.length < 3) return null;

  // Never parse a balance line or a top-up line as a spending transaction
  if (isBalanceLine(t) && !/(?:Paid|Spent|扣除|for\s+Bus|for\s+Train|Purchase)/i.test(t)) {
    return null;
  }
  if (isTopUpLine(t)) {
    return null;
  }

  let m: RegExpMatchArray | null;

  // 1. Apple Wallet Lock Screen Octopus format:
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

  // 2. Octopus Chinese Spend (e.g. "八達通: 於九巴扣除 HK$8.70。餘額 HK$350.20")
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

  // 3. Octopus English Spend (e.g. "Octopus: Paid HK$8.70 at KMB Bus. Remaining balance HK$350.20")
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

  // 4a. Apple Pay / Wallet with card AND merchant: "You paid HK$350.00 at UNIQLO with Hang Seng Card."
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

  // 4b. Apple Pay / Wallet without merchant (when iOS omits Merchant in Shortcuts): "You paid HK$8.20 with Octopus"
  if ((m = t.match(/(?:You paid|Paid|Spent|Payment of)?\s*(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at\s+)?with\s+([^.·\n]+?)(?:\.|$)/i))) {
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

  // 5. PayMe Notifications (P2P and merchants)
  // 5a. PayMe: Merchant before amount (e.g. "You've paid Karen Chan HK$150.00" / "已付款給 Karen Chan HK$150.00")
  if ((m = t.match(/(?:You(?:'ve)? paid|paid|已付款|轉賬給|付款給)\s+([^0-9$]+?)\s+(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i))) {
    const target = m[1].replace(/^(?:to|於|給|at)\s+/i, "").trim();
    if (isDateOrTimestampLabel(target)) return null;
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

  // 5b. PayMe: Amount before merchant (e.g. "You've paid HK$150.00 to Karen Chan" / "已付款 HK$150.00 給 Karen Chan")
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

  // 6. Bank & Credit Card Notifications (HSBC, Hang Seng, Standard Chartered, Mox, ZA, Citi, BOC, DBS)
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

  // 7. Amount with destination: "HK$8.70 at KMB" / "HK$150.00 to Karen" / "$45 at Starbucks"
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

  // 8. General Smart Fallback Pattern
  if ((m = t.match(/(?:spent|paid|payment of|簽賬|付款)\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|於)?\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].replace(/\s+(?:on|with).*$/, "").trim();
    if (isDateOrTimestampLabel(merchant)) return null;
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

/**
 * Parses an Apple Wallet Lock Screen notification stack or "Latest Transactions" history screenshot.
 * - Never includes "Your new balance is..." or top-ups (+HK$..., Top-up, Reload, Add Value).
 * - Never mistakes dates ("2026-10-07", "07/10/2026", "7 Oct") or weekdays ("Tuesday", "Thu 18:56", "1h ago") for merchant names.
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

    // 1. Balance statement (e.g. "Your new balance is HK$11.00.") -> attach to previous item for deduplication, never create a transaction
    if (isBalanceLine(line)) {
      const balMinor = extractBalanceMinor(line);
      if (balMinor !== undefined && items.length > 0 && items[items.length - 1].balanceAfterMinor === undefined) {
        items[items.length - 1].balanceAfterMinor = balMinor;
      }
      continue;
    }

    // 2. Skip top-up lines completely
    if (isTopUpLine(line)) {
      pendingTimestampLabel = null;
      continue;
    }

    // 3. Check if this line is purely a date, weekday, or timestamp (e.g. "2026-10-07", "Tuesday", "Octopus Thu 18:56", "1h ago")
    if (isDateOrTimestampLabel(line)) {
      // Ignore the iPhone top-left status bar clock at index 0
      if (i > 0 || !/^\d{1,2}:\d{2}$/.test(line)) {
        pendingTimestampLabel = line.replace(/^(?:Octopus|Wallet|Apple Pay|PayMe)\s+/i, "").trim();
      }
      continue;
    }

    if (noise.test(line)) continue;

    // 4. Check if the line is a direct single-line notification (e.g. "HK$8.70 for Bus" or "HK$20.00 Purchase")
    const directSingle = parseNotification(line, refDate);
    if (directSingle) {
      let tsLabel = pendingTimestampLabel;
      if (!tsLabel) {
        // Look up to 2 lines ahead for a timestamp or date label
        for (let j = i + 1; j <= Math.min(rawLines.length - 1, i + 2); j++) {
          const nextL = rawLines[j];
          if (isBalanceLine(nextL)) continue;
          if (isDateOrTimestampLabel(nextL)) {
            tsLabel = nextL.replace(/^(?:Octopus|Wallet|Apple Pay|PayMe)\s+/i, "").trim();
            break;
          }
        }
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

    // 5. Otherwise check for Apple Wallet / Octopus App multi-line layout
    const amtMatch = line.match(/([+-]?)\s*(?:HKD|HK\$|\$)\s*([0-9,]+\.[0-9]{1,2})/i);
    if (!amtMatch) continue;

    const sign = amtMatch[1];
    if (sign === "+") {
      // Top-up -> skip
      pendingTimestampLabel = null;
      continue;
    }

    const amountMinor = Math.round(parseFloat(amtMatch[2].replace(/,/g, "")) * 100);
    if (amountMinor <= 0) continue;

    const rawPrefix = line.slice(0, amtMatch.index).replace(/[-–—:]+$/, "").trim();
    const rawSuffix = line
      .slice((amtMatch.index ?? 0) + amtMatch[0].length)
      .replace(/^[.\s-–—:]+|[.\s]+$/g, "")
      .trim();

    // Separate any embedded date/timestamp from prefix & suffix so a date/time NEVER becomes the merchant name!
    const prefixSplit = splitDateFromText(rawPrefix);
    const suffixSplit = splitDateFromText(rawSuffix);

    let title = prefixSplit.remainingText;
    let subtitle: string | null = null;
    let dayLabel: string | null = prefixSplit.dateLabel ?? suffixSplit.dateLabel ?? pendingTimestampLabel;

    if (!title && suffixSplit.remainingText) {
      const forMatch = suffixSplit.remainingText.match(/^(?:for\s+)?([A-Za-z0-9 &/-]+)$/i);
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

    // Look 1-3 lines backward if title or dayLabel is still missing
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const prevLine = rawLines[j];
      if (isBalanceLine(prevLine) || noise.test(prevLine)) continue;
      if (/([+-]?)\s*(?:HKD|HK\$|\$)\s*[0-9,]+\.[0-9]{1,2}/i.test(prevLine)) break;

      const prevSplit = splitDateFromText(prevLine);
      if (prevSplit.dateLabel && !dayLabel) {
        dayLabel = prevSplit.dateLabel;
      }
      const cleanPrev = prevSplit.remainingText;
      if (!cleanPrev) continue;

      if (transportSubRegex.test(cleanPrev) && !subtitle) {
        subtitle = cleanPrev;
      } else if (!title) {
        title = cleanPrev;
      }
    }

    // Look 1-2 lines ahead if subtitle or dayLabel is still missing
    for (let j = i + 1; j <= Math.min(rawLines.length - 1, i + 2); j++) {
      const nextLine = rawLines[j];
      if (isBalanceLine(nextLine) || noise.test(nextLine)) continue;
      if (/([+-]?)\s*(?:HKD|HK\$|\$)\s*[0-9,]+\.[0-9]{1,2}/i.test(nextLine)) break;

      const nextSplit = splitDateFromText(nextLine);
      if (nextSplit.dateLabel && !dayLabel) {
        dayLabel = nextSplit.dateLabel;
      }
      const cleanNext = nextSplit.remainingText;
      if (!cleanNext) continue;

      if (transportSubRegex.test(cleanNext) && !subtitle) {
        subtitle = cleanNext;
      } else if (!title) {
        title = cleanNext;
      }
    }

    if (isTopUpLine(`${title} ${subtitle ?? ""}`)) {
      pendingTimestampLabel = null;
      continue;
    }

    let merchant = title || subtitle || "Octopus Purchase";
    let location: string | undefined = undefined;
    let subcategoryHint: string | undefined = undefined;

    if (subtitle && title && title.toLowerCase() !== subtitle.toLowerCase()) {
      merchant = subtitle;
      location = title;
      subcategoryHint = subtitle;
    } else if (transportSubRegex.test(merchant)) {
      subcategoryHint = merchant;
    }

    const resolved = resolveRelativeDay(dayLabel, refDate, items.length);

    items.push({
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      location,
      subcategoryHint,
      type: "expense",
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
    .filter((l) => l.length > 3 && !isBalanceLine(l) && !isTopUpLine(l));
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
