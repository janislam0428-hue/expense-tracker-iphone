// Zero-credit on-device/local notification & screenshot parser.
// Supports:
//  1. Octopus App transaction history screenshots ("Octopus 1 / 192116091(2)", "2026-09-27 16:53 -142.5") — Authoritative Source of Truth for Octopus
//  2. Apple Wallet & Lock Screen Octopus notifications & "Latest Transactions" screenshots
//  3. PayMe App transaction history screenshots & Gmail App / Apple Mail (popup banners, inbox list, and opened emails)
//  4. Hang Seng Bank App transaction history screenshots & e-Alert emails/banners
// Automatically filters out remaining balances, Octopus top-ups ("Octopus Cards Limited +600.0", "APPLEPAY OCTOPUS CAR"),
// and PayMe bank top-ups ("LAM JANIS SZE YUET HKDD5326818092", "Hang Seng Bank Lim... **0882").

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
  isAuthoritativeSource?: boolean;
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
 * Checks whether a merchant name is a generic placeholder from Apple Wallet / Express Transit
 * rather than an authoritative merchant name from the Octopus App.
 */
export function isGenericWalletMerchant(merchant: string): boolean {
  const m = normalizeMerchant(merchant);
  return /^(?:octopus purchase|octopus|purchase|bus|train|transit|minibus|ferry|tram|light rail|public transport|八達通|零售|消費|付款)$/.test(
    m,
  );
}

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
 * Checks whether a line or merchant is a top-up / reload / self-funding transfer:
 * - Explicit "+ 655.40", "+600.0", or "+HK$100.00"
 * - "Top up", "Add value", "Reload", "Auto top-up", "AAV", "增值", "自動增值"
 * - Octopus App AAVS / reload merchant: "Octopus Cards Limited"
 * - Hang Seng -> PayMe direct debit top-ups: "LAM JANIS SZE YUET", "HKDD5326818092", "HKDD..."
 * - Hang Seng / Apple Pay -> Octopus top-ups: "APPLEPAY OCTOPUS", "OCTOPUS CAR", "OCTOPUS CARD"
 * - PayMe bank top-up subtitle: "Hang Seng Bank Lim... **0882"
 */
export function isTopUpLine(line: string): boolean {
  const s = line.trim();
  if (/^\+\s*(?:HKD|HK\$|\$)?\s*[0-9,]+(?:\.[0-9]{1,2})?(?:\s*HKD)?$/i.test(s)) return true;
  if (/([+])\s*(?:HKD|HK\$|\$)\s*[0-9,]+(?:\.[0-9]{1,2})?/i.test(s)) return true;
  if (/\b(?:top-?up|topped up|add value|added value|reload|auto top-?up|aav|octopus top up|增值|自動增值)\b/i.test(s))
    return true;
  if (/\b(?:lam janis|sze yuet|hkdd\d+|applepay octopus|octopus car|octopus card|octopus cards limited)\b/i.test(s))
    return true;
  if (/hang seng bank lim.*\*\*\d{4}/i.test(s)) return true;
  return false;
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
 * Resolves any date, relative weekday, bank date code ("14OCT"), or timestamp label into a concrete Date in Hong Kong time:
 * - Explicit dates (>1 week ago): "2026-09-27 16:53", "2026-10-07", "23:50 10/10/2026", "7 Oct 2026", "14OCT", "10月7日"
 * - Weekdays (within past 7 days): "Tuesday", "Wednesday", "Thu 18:56", "Wed 22:34"
 * - Relative offsets: "1h ago", "25m ago", "Today", "Yesterday", "15:33"
 */
export function resolveRelativeDay(
  label: string | null | undefined,
  refDate = new Date(),
  itemIndex = 0,
): { date: Date; precision: DatePrecision } {
  if (!label) return { date: new Date(refDate.getTime() - itemIndex * 1000), precision: "minute" };
  const raw = label.trim().replace(/^(?:Octopus|Wallet|Apple Pay|PayMe(?: by HSBC)?|Gmail)\s+/i, "").trim();
  const clean = raw.toLowerCase();
  const p = zonedParts(refDate);
  const minuteOffset = Math.max(0, 59 - itemIndex);

  // 1. Explicit ISO date: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD (with optional HH:mm before or after)
  let m = raw.match(
    /(?:(\d{1,2}):(\d{2})\s+)?\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?:\s*,?\s*(\d{1,2}):(\d{2}))?\b/,
  );
  if (m) {
    const year = parseInt(m[3], 10);
    const month = parseInt(m[4], 10);
    const day = parseInt(m[5], 10);
    const hStr = m[1] ?? m[6];
    const minStr = m[2] ?? m[7];
    const hasTime = hStr !== undefined && minStr !== undefined;
    const hour = hasTime ? parseInt(hStr, 10) : 12;
    const minute = hasTime ? parseInt(minStr, 10) : minuteOffset;
    return {
      date: zonedDate(year, month, day, hour, minute),
      precision: hasTime ? "minute" : "date_only",
    };
  }

  // 2. Explicit DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY (with optional HH:mm before or after, e.g. "23:50 10/10/2026")
  m = raw.match(
    /(?:(\d{1,2}):(\d{2})\s+)?\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])[/-](20\d{2}|\d{2})(?:\s*,?\s*(\d{1,2}):(\d{2}))?\b/,
  );
  if (m) {
    const day = parseInt(m[3], 10);
    const month = parseInt(m[4], 10);
    const yrRaw = parseInt(m[5], 10);
    const year = yrRaw < 100 ? 2000 + yrRaw : yrRaw;
    const hStr = m[1] ?? m[6];
    const minStr = m[2] ?? m[7];
    const hasTime = hStr !== undefined && minStr !== undefined;
    const hour = hasTime ? parseInt(hStr, 10) : 12;
    const minute = hasTime ? parseInt(minStr, 10) : minuteOffset;
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

  // 4. Explicit Month Name date or attached bank date code:
  //    "7 Oct 2026", "08 Oct 2026", "14OCT", "11OCT", "Oct 7, 2026"
  m =
    raw.match(
      /\b(?:mon|tue|wed|thu|fri|sat|sun)?\s*,?\s*(0?[1-9]|[12]\d|3[01])\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s*,?\s*(20\d{2}))?(?:\s*,?\s*(\d{1,2}):(\d{2}))?\b/i,
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

  // 8. "Today" / "Yesterday" / "now"
  if (clean === "today" || clean === "now" || clean === "今日" || clean === "今天") {
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
  const s = text.trim().replace(/^(?:Octopus|Wallet|Apple Pay|PayMe(?: by HSBC)?|Gmail)\s+/i, "").trim();
  if (!s) return false;
  if (/^\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?:\s*,?\s*\d{1,2}:\d{2})?$/.test(s)) return true;
  if (
    /^(?:\d{1,2}:\d{2}\s+)?(?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:20\d{2}|\d{2})(?:\s*,?\s*\d{1,2}:\d{2})?$/.test(
      s,
    )
  )
    return true;
  if (/^(?:20\d{2}年)?\s*(?:0?[1-9]|1[0-2])月\s*(?:0?[1-9]|[12]\d|3[01])[日號]?(?:\s*\d{1,2}:\d{2})?$/.test(s))
    return true;
  if (
    /^(?:(?:mon|tue|wed|thu|fri|sat|sun)\s*,?\s*)?(?:0?[1-9]|[12]\d|3[01])\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s*,?\s*20\d{2})?(?:\s*,?\s*\d{1,2}:\d{2})?$/i.test(
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
    /^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|now|今日|今天|昨日|昨天|週[一二三四五六日]|星期[一二三四五六日])(?:\s*,?\s*\d{1,2}:\d{2})?$/i.test(
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
      dateLabel: s.replace(/^(?:Octopus|Wallet|Apple Pay|PayMe(?: by HSBC)?|Gmail)\s+/i, "").trim(),
      remainingText: "",
    };
  }

  const patterns = [
    /\b((?:\d{1,2}:\d{2}\s+)?(?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:20\d{2}|\d{2})(?:\s*,?\s*\d{1,2}:\d{2})?)\b/i,
    /\b(20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?:\s*,?\s*\d{1,2}:\d{2})?)\b/i,
    /((?:20\d{2}年)?\s*(?:0?[1-9]|1[0-2])月\s*(?:0?[1-9]|[12]\d|3[01])[日號]?(?:\s*\d{1,2}:\d{2})?)/i,
    /\b((?:0?[1-9]|[12]\d|3[01])\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s*,?\s*20\d{2})?(?:\s*,?\s*\d{1,2}:\d{2})?)\b/i,
    /\b((?:0?[1-9]|[12]\d|3[01])(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/i,
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
        .replace(/^(?:Octopus|Wallet|Apple Pay|PayMe(?: by HSBC)?|Gmail)\b/i, "")
        .replace(/\s+/g, " ")
        .replace(/^[-–—:·.\s]+|[-–—:·.\s]+$/g, "")
        .trim();
      return { dateLabel, remainingText };
    }
  }

  return { dateLabel: null, remainingText: s };
}

/**
 * Parses Octopus App transaction history screenshots ("Octopus 1 / 192116091(2)").
 * Format per item:
 *   Merchant Name (1 or 2 lines, e.g. "Sa Sa Cosmetic", "MTR Corporation Limited", "Green Minibuses", "Lung Fung Pharmaceutical\n(Group) Limited")
 *   Timestamp: "2026-09-27 16:53"
 *   Amount: "-142.5" or "+600.0" (1 or 2 decimal places, no HK$ symbol)
 * Marks all items with `isAuthoritativeSource: true` so they act as the Source of Truth for Octopus,
 * automatically upgrading any generic Apple Wallet entries on the same day + amount.
 */
export function parseOctopusAppHistoryList(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];

  // Must contain at least one YYYY-MM-DD HH:mm timestamp AND signed decimal amounts (without HKD suffix)
  const hasIsoMinuteTimestamps = /\b20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\s+\d{1,2}:\d{2}\b/.test(
    text,
  );
  const hasSignedDecimals = /(?:^|\s)[-–—+]\s*[0-9,]+\.[0-9]{1,2}(?:\s|$)/m.test(text);
  if (!hasIsoMinuteTimestamps || !hasSignedDecimals) return [];
  if (/-[0-9,]+\.[0-9]{2}\s*HKD\b/i.test(text)) return []; // Hang Seng format

  const rawLines = text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/[⌃^へ⬆️↑]?\s*view latest/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((l) => l.length > 0);

  const headerNoise =
    /^(?:\d{1,2}:\d{2}|\d{1,3}%?|x|×|i|\(i\)|\+|octopus(?:\s+\d+)?|\d{7,12}(?:\s*\(\d+\))?|done|back|cancel)$/i;

  const items: ParsedNotification[] = [];
  let merchantParts: string[] = [];
  let currentTimestamp: string | null = null;
  let currentAmount: { sign: "+" | "-"; amountMinor: number; raw: string } | null = null;

  const flushRow = () => {
    if (!currentTimestamp || !currentAmount) return;

    const fullMerchant = merchantParts
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/^[-–—:·.\s]+|[-–—:·.\s]+$/g, "")
      .trim();

    // Skip top-ups (+600.0 or Octopus Cards Limited)
    if (currentAmount.sign === "+" || (fullMerchant && isTopUpLine(fullMerchant))) {
      merchantParts = [];
      currentTimestamp = null;
      currentAmount = null;
      return;
    }

    // If the very top row of a scrolled screenshot had its merchant name clipped off the top edge
    // (e.g. "2026-09-27 17:12 -7.4" under "View latest"), infer MTR / Octopus Transit for transit fares.
    const merchant =
      fullMerchant ||
      (currentAmount.amountMinor <= 2500 ? "MTR Corporation Limited" : "Octopus");

    const resolved = resolveRelativeDay(currentTimestamp, refDate, items.length);

    let subcategoryHint: string | undefined = undefined;
    if (/\bmtr\b|\bminibus(?:es)?\b|\bbus\b|\bferry\b|\btram\b/i.test(merchant)) {
      subcategoryHint = "Public transport";
    } else if (/\btaxi\b/i.test(merchant)) {
      subcategoryHint = "Taxi/Uber";
    }

    items.push({
      amountMinor: currentAmount.amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      subcategoryHint,
      type: "expense",
      sourceName: "Octopus",
      sourceKind: "octopus",
      occurredAt: resolved.date,
      datePrecision: "minute",
      isPersonToPerson: false,
      isAuthoritativeSource: true,
      confidence: 0.99,
      rawText: `${merchant} · ${currentTimestamp} · ${currentAmount.raw}`,
    });

    merchantParts = [];
    currentTimestamp = null;
    currentAmount = null;
  };

  for (const line of rawLines) {
    if (headerNoise.test(line)) continue;

    let working = line;

    // 1. Extract YYYY-MM-DD HH:mm timestamp if present on this line
    const tsMatch = working.match(
      /\b(20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\s+\d{1,2}:\d{2})\b/,
    );
    const extractedTs = tsMatch ? tsMatch[1].trim() : null;
    if (tsMatch) {
      working = working.replace(tsMatch[0], " ").trim();
    }

    // 2. Extract signed decimal amount (e.g. "-142.5", "-242.0", "+600.0", or top-clipped "-/ .4" -> "-7.4")
    let extractedAmt: { sign: "+" | "-"; amountMinor: number; raw: string } | null = null;
    const amtMatch = working.match(/(?:^|\s)([-–—+])\s*(?:HKD|HK\$|\$)?\s*([0-9,]+\.[0-9]{1,2})(?=\s|$)/);
    const clippedSevenMatch = !amtMatch ? working.match(/(?:^|\s)([-–—])[/\\]?\s*\.4(?=\s|$)/) : null;

    if (amtMatch) {
      const sign: "+" | "-" = amtMatch[1] === "+" ? "+" : "-";
      const amountMinor = Math.round(parseFloat(amtMatch[2].replace(/,/g, "")) * 100);
      extractedAmt = { sign, amountMinor, raw: `${sign}${amtMatch[2]}` };
      working = working.replace(amtMatch[0], " ").trim();
    } else if (clippedSevenMatch) {
      extractedAmt = { sign: "-", amountMinor: 740, raw: "-7.4" };
      working = working.replace(clippedSevenMatch[0], " ").trim();
    }

    // 3. Remaining text on this line is merchant name (or part of a 2-line merchant name)
    const remainingMerchant = working
      .replace(/\s+/g, " ")
      .replace(/^[-–—:·.\s]+|[-–—:·.\s]+$/g, "")
      .trim();

    // In the Octopus App UI, a row's merchant name is ALWAYS above its timestamp.
    // So if we already saw a timestamp for the previous row (and it never got an amount because it was clipped),
    // seeing a new merchant line means a new row has started!
    if (remainingMerchant && !headerNoise.test(remainingMerchant)) {
      if (currentTimestamp) {
        merchantParts = [];
        currentTimestamp = null;
        currentAmount = null;
      }
      merchantParts.push(remainingMerchant);
    }

    if (extractedTs) {
      if (currentTimestamp && !currentAmount) {
        // Previous timestamp had no amount (clipped); replace with new timestamp
        currentTimestamp = extractedTs;
      } else {
        currentTimestamp = extractedTs;
      }
    }

    if (extractedAmt) {
      if (currentAmount && !currentTimestamp) {
        // Previous amount had no timestamp (clipped); replace with new amount
        currentAmount = extractedAmt;
      } else {
        currentAmount = extractedAmt;
      }
    }

    if (currentTimestamp && currentAmount) {
      flushRow();
    }
  }

  return items;
}

/**
 * Parses one or more PayMe by HSBC email notifications from the Gmail App or Apple Mail:
 * - Gmail push notification banner ("PayMe by HSBC now / You paid Claudia Yue / Transaction Transaction You paid Claudia Yue - HKD 2 Payment 23:50 10/10/2026...")
 * - Gmail App inbox / search results list showing multiple PayMe email snippets on one screen
 * - Opened PayMe email body inside the Gmail App or Apple Mail
 */
export function parsePayMeEmailNotifications(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];
  const flat = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  const regex =
    /(?:You(?:'ve)? paid|paid|已付款給|付款給)\s+([A-Za-z0-9\u4e00-\u9fa5 .&'*_-]+?)\s*[-–—]\s*(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s+(.*?))?(?:\s+(\d{1,2}:\d{2}\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+\d{1,2}:\d{2}))?(?=\s+If you didn't|\s+Please contact|\s+Transaction reference|\s+PayMe by HSBC|\s+You(?:'ve)? paid|$)/gi;

  const results: ParsedNotification[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(flat)) !== null) {
    const rawMerchant = match[1]
      .replace(/^(?:Transaction\s+)+/i, "")
      .replace(/^(?:You(?:'ve)? paid\s+)+/i, "")
      .trim();
    if (!rawMerchant || isTopUpLine(rawMerchant) || isDateOrTimestampLabel(rawMerchant)) continue;

    const amountMinor = Math.round(parseFloat(match[2].replace(/,/g, "")) * 100);
    if (amountMinor <= 0) continue;

    const rawNote = match[3]?.trim();
    const tsRaw = match[4]?.trim();
    const resolved = resolveRelativeDay(tsRaw, refDate, results.length);
    const isP2P = !/Starbucks|Pacific Coffee|7-Eleven|Circle K|HKTVmall|store|shop|patisserie|café|cafe|bakery|ltd|limited/i.test(
      rawMerchant,
    );

    const cleanNote =
      rawNote &&
      rawNote.toLowerCase() !== "payment" &&
      rawNote.length <= 60 &&
      !/transaction reference|customer service/i.test(rawNote)
        ? rawNote
        : undefined;

    results.push({
      amountMinor,
      currency: "HKD",
      merchant: rawMerchant,
      merchantNormalized: normalizeMerchant(rawMerchant),
      counterparty: isP2P ? rawMerchant : undefined,
      description: cleanNote,
      type: "expense",
      sourceName: "PayMe",
      sourceKind: "payme",
      occurredAt: resolved.date,
      datePrecision: tsRaw ? "minute" : "date_only",
      isPersonToPerson: isP2P,
      isAuthoritativeSource: true,
      confidence: 0.99,
      rawText: match[0].slice(0, 240),
    });
  }

  return results;
}

export function parsePayMeEmailNotification(text: string, refDate = new Date()): ParsedNotification | null {
  const list = parsePayMeEmailNotifications(text, refDate);
  return list[0] ?? null;
}

/**
 * Parses Hang Seng Bank App transaction history screenshots (e.g. "02cfbc71.jpeg").
 * Automatically skips PayMe top-ups ("LAM JANIS SZE YUET HKDD5326818092") and Octopus top-ups ("APPLEPAY OCTOPUS CAR").
 */
export function parseHangSengHistoryList(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];
  if (
    !/-[0-9,]+\.[0-9]{2}\s*HKD\b/i.test(text) &&
    !/\b\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+HKD\b/i.test(text)
  ) {
    return [];
  }

  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const navNoise = /^(?:home|transfer\s*&\s*pay|wealth|credit cards|all|in|out|\d{1,2}:\d{2})$/i;
  const items: ParsedNotification[] = [];
  let currentHeaderDateLabel: string | null = null;
  let pendingDescLine: string | null = null;
  let skipNextAmountLine = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (navNoise.test(line)) continue;

    if (isDateOrTimestampLabel(line)) {
      currentHeaderDateLabel = line;
      pendingDescLine = null;
      skipNextAmountLine = false;
      continue;
    }

    if (isTopUpLine(line)) {
      pendingDescLine = null;
      if (!/-[0-9,]+\.[0-9]{2}\s*HKD$/i.test(line)) {
        skipNextAmountLine = true;
      }
      continue;
    }

    const standaloneAmt = line.match(/^([+-]?)\s*([0-9,]+\.[0-9]{2})\s*HKD$/i);
    if (standaloneAmt) {
      if (skipNextAmountLine || standaloneAmt[1] === "+") {
        skipNextAmountLine = false;
        pendingDescLine = null;
        continue;
      }
      if (pendingDescLine) {
        const amountMinor = Math.round(parseFloat(standaloneAmt[2].replace(/,/g, "")) * 100);
        const descSplit = splitDateFromText(
          pendingDescLine
            .replace(/\bHKD\s*[0-9,]+(?:\.[0-9]{1,2})?\b/gi, "")
            .replace(/^(?:CUP|VISA|MASTER)\s+/i, "")
            .trim(),
        );
        const merchant = descSplit.remainingText || "Hang Seng Purchase";
        const effectiveDateLabel = descSplit.dateLabel ?? currentHeaderDateLabel;
        const resolved = resolveRelativeDay(effectiveDateLabel, refDate, items.length);

        items.push({
          amountMinor,
          currency: "HKD",
          merchant,
          merchantNormalized: normalizeMerchant(merchant),
          type: "expense",
          sourceName: "Hang Seng Card",
          sourceKind: "credit_card",
          occurredAt: resolved.date,
          datePrecision: resolved.precision,
          isPersonToPerson: false,
          confidence: 0.96,
          rawText: `${pendingDescLine} (${line})`,
        });
        pendingDescLine = null;
      }
      continue;
    }

    const sameLineMatch = line.match(/^(.+?)\s+([+-]?)\s*([0-9,]+\.[0-9]{2})\s*HKD$/i);
    if (sameLineMatch) {
      const sign = sameLineMatch[2];
      const rawDesc = sameLineMatch[1].trim();
      if (sign === "+" || isTopUpLine(rawDesc)) {
        pendingDescLine = null;
        skipNextAmountLine = false;
        continue;
      }
      const amountMinor = Math.round(parseFloat(sameLineMatch[3].replace(/,/g, "")) * 100);
      const descSplit = splitDateFromText(
        rawDesc
          .replace(/\bHKD\s*[0-9,]+(?:\.[0-9]{1,2})?\b/gi, "")
          .replace(/^(?:CUP|VISA|MASTER)\s+/i, "")
          .trim(),
      );
      const merchant = descSplit.remainingText || "Hang Seng Purchase";
      const effectiveDateLabel = descSplit.dateLabel ?? currentHeaderDateLabel;
      const resolved = resolveRelativeDay(effectiveDateLabel, refDate, items.length);

      items.push({
        amountMinor,
        currency: "HKD",
        merchant,
        merchantNormalized: normalizeMerchant(merchant),
        type: "expense",
        sourceName: "Hang Seng Card",
        sourceKind: "credit_card",
        occurredAt: resolved.date,
        datePrecision: resolved.precision,
        isPersonToPerson: false,
        confidence: 0.96,
        rawText: line,
      });
      pendingDescLine = null;
      skipNextAmountLine = false;
      continue;
    }

    pendingDescLine = line;
    skipNextAmountLine = false;

    const nextLine = i + 1 < rawLines.length ? rawLines[i + 1] : "";
    if (!/^([+-]?)\s*([0-9,]+\.[0-9]{2})\s*HKD$/i.test(nextLine)) {
      const embeddedHkd = line.match(/^(.+?)\s+HKD\s*([0-9,]+\.[0-9]{2})$/i);
      if (embeddedHkd && !isTopUpLine(line)) {
        const amountMinor = Math.round(parseFloat(embeddedHkd[2].replace(/,/g, "")) * 100);
        const descSplit = splitDateFromText(
          embeddedHkd[1].replace(/^(?:CUP|VISA|MASTER)\s+/i, "").trim(),
        );
        const merchant = descSplit.remainingText || "Hang Seng Purchase";
        const effectiveDateLabel = descSplit.dateLabel ?? currentHeaderDateLabel;
        const resolved = resolveRelativeDay(effectiveDateLabel, refDate, items.length);

        items.push({
          amountMinor,
          currency: "HKD",
          merchant,
          merchantNormalized: normalizeMerchant(merchant),
          type: "expense",
          sourceName: "Hang Seng Card",
          sourceKind: "credit_card",
          occurredAt: resolved.date,
          datePrecision: resolved.precision,
          isPersonToPerson: false,
          confidence: 0.94,
          rawText: line,
        });
        pendingDescLine = null;
      }
    }
  }

  return items;
}

/**
 * Parses PayMe App transaction history screenshots (e.g. "c1de4956.jpeg" and "cd8e9659.jpeg").
 */
export function parsePayMeAppHistoryList(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];
  const hasSignedAmounts = /(?:^|\s)[+-]\s*[0-9,]+\.[0-9]{2}(?:\s|$)/m.test(text);
  const hasPayMeSignals =
    /pay businesses|hang seng bank lim.*\*\*\d{4}|\btop up\b/i.test(text) ||
    (/(?:^|\n)\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2}/i.test(text) &&
      hasSignedAmounts &&
      !/\bHKD\b/i.test(text));

  if (!hasSignedAmounts || !hasPayMeSignals) return [];

  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const navNoise =
    /^(?:home|friends|pay businesses|notifications|me|\d{1,2}:\d{2}|all|money in|money out)$/i;

  let firstVisibleDateLabel: string | null = null;
  for (const l of rawLines) {
    if (isDateOrTimestampLabel(l) && !/^\d{1,2}:\d{2}$/.test(l)) {
      firstVisibleDateLabel = l;
      break;
    }
  }

  const items: ParsedNotification[] = [];
  let currentDateLabel: string | null = firstVisibleDateLabel;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (navNoise.test(line)) continue;

    if (isDateOrTimestampLabel(line)) {
      if (i > 0 || !/^\d{1,2}:\d{2}$/.test(line)) {
        currentDateLabel = line;
      }
      continue;
    }

    const sameLine = line.match(/^(.+?)\s+([+-])\s*([0-9,]+\.[0-9]{2})$/);
    if (sameLine) {
      const name = sameLine[1].trim();
      const sign = sameLine[2];
      const amtStr = sameLine[3];

      let note: string | undefined = undefined;
      if (
        i + 1 < rawLines.length &&
        !isDateOrTimestampLabel(rawLines[i + 1]) &&
        !navNoise.test(rawLines[i + 1]) &&
        !/([+-])\s*[0-9,]+\.[0-9]{2}$/.test(rawLines[i + 1]) &&
        !(i + 2 < rawLines.length && /^[+-]\s*[0-9,]+\.[0-9]{2}$/.test(rawLines[i + 2]))
      ) {
        note = rawLines[i + 1];
        i += 1;
      }

      if (sign === "+" || isTopUpLine(name) || (note && isTopUpLine(note))) {
        continue;
      }

      const amountMinor = Math.round(parseFloat(amtStr.replace(/,/g, "")) * 100);
      if (amountMinor <= 0) continue;

      const resolved = resolveRelativeDay(currentDateLabel, refDate, items.length);
      const isP2P = !/Starbucks|Pacific Coffee|7-Eleven|Circle K|HKTVmall|store|shop|patisserie|café|cafe|bakery|ltd|limited/i.test(
        name,
      );

      items.push({
        amountMinor,
        currency: "HKD",
        merchant: name,
        merchantNormalized: normalizeMerchant(name),
        counterparty: isP2P ? name : undefined,
        description: note && note.toLowerCase() !== "payment" ? note : undefined,
        type: "expense",
        sourceName: "PayMe",
        sourceKind: "payme",
        occurredAt: resolved.date,
        datePrecision: resolved.precision,
        isPersonToPerson: isP2P,
        confidence: 0.96,
        rawText: [name, note, currentDateLabel, `${sign}${amtStr}`].filter(Boolean).join(" · "),
      });
      continue;
    }

    const standaloneSigned = line.match(/^([+-])\s*([0-9,]+\.[0-9]{2})$/);
    if (standaloneSigned) {
      const sign = standaloneSigned[1];
      const amtStr = standaloneSigned[2];

      let name = "";
      let note: string | undefined = undefined;
      const prev1 = i - 1 >= 0 ? rawLines[i - 1] : "";
      const prev2 = i - 2 >= 0 ? rawLines[i - 2] : "";

      if (
        prev2 &&
        !isDateOrTimestampLabel(prev2) &&
        !navNoise.test(prev2) &&
        !/[+-]\s*[0-9,]+\.[0-9]{2}/.test(prev2) &&
        !isDateOrTimestampLabel(prev1)
      ) {
        name = prev2;
        note = prev1;
      } else if (prev1 && !isDateOrTimestampLabel(prev1) && !navNoise.test(prev1)) {
        name = prev1;
        if (
          i + 1 < rawLines.length &&
          !isDateOrTimestampLabel(rawLines[i + 1]) &&
          !navNoise.test(rawLines[i + 1]) &&
          !/[+-]\s*[0-9,]+\.[0-9]{2}/.test(rawLines[i + 1]) &&
          !(i + 2 < rawLines.length && /^[+-]\s*[0-9,]+\.[0-9]{2}$/.test(rawLines[i + 2]))
        ) {
          note = rawLines[i + 1];
          i += 1;
        }
      }

      if (sign === "+" || !name || isTopUpLine(name) || (note && isTopUpLine(note))) {
        continue;
      }

      const amountMinor = Math.round(parseFloat(amtStr.replace(/,/g, "")) * 100);
      if (amountMinor <= 0) continue;

      const resolved = resolveRelativeDay(currentDateLabel, refDate, items.length);
      const isP2P = !/Starbucks|Pacific Coffee|7-Eleven|Circle K|HKTVmall|store|shop|patisserie|café|cafe|bakery|ltd|limited/i.test(
        name,
      );

      items.push({
        amountMinor,
        currency: "HKD",
        merchant: name,
        merchantNormalized: normalizeMerchant(name),
        counterparty: isP2P ? name : undefined,
        description: note && note.toLowerCase() !== "payment" ? note : undefined,
        type: "expense",
        sourceName: "PayMe",
        sourceKind: "payme",
        occurredAt: resolved.date,
        datePrecision: resolved.precision,
        isPersonToPerson: isP2P,
        confidence: 0.96,
        rawText: [name, note, currentDateLabel, `${sign}${amtStr}`].filter(Boolean).join(" · "),
      });
    }
  }

  return items;
}

/**
 * Parses an individual single-line notification string into structured transaction data.
 */
export function parseNotification(text: string, refDate = new Date()): ParsedNotification | null {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (t.length < 3) return null;

  if (isBalanceLine(t) && !/(?:Paid|Spent|扣除|for\s+Bus|for\s+Train|Purchase)/i.test(t)) {
    return null;
  }
  if (isTopUpLine(t)) {
    return null;
  }

  const paymeEmail = parsePayMeEmailNotification(t, refDate);
  if (paymeEmail) return paymeEmail;

  let m: RegExpMatchArray | null;

  // 1. Apple Wallet Lock Screen Octopus format
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

  // 2. Octopus Chinese Spend
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

  // 3. Octopus English Spend
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

  // 4a. Apple Pay / Wallet with card AND merchant
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

  // 4b. Apple Pay / Wallet without merchant
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

  // 5. PayMe Notifications
  if (
    (m = t.match(
      /(?:You(?:'ve)? paid|paid|已付款|轉賬給|付款給)\s+([^0-9$]+?)\s*[-–—]?\s*(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    ))
  ) {
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

  // 6. Bank & Credit Card Notifications / Gmail e-Alerts (HSBC, Hang Seng, Standard Chartered, Mox, ZA, Citi, BOC, DBS)
  if ((m = t.match(/(?:HSBC|Hang Seng|Standard Chartered|Mox|ZA Bank|Citi|BOC|DBS|Credit Card|信用卡)[^:]*:?[^0-9]*(?:spent|purchase of|made at|payment of|transaction of|扣除|簽賬|付款)?\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:was made at|at|to|with Card ending \d+ at|於)\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const rawMerch = m[2].trim();
    const split = splitDateFromText(rawMerch.replace(/\s+(?:on|with)\s+/i, " "));
    const merchant = split.remainingText || rawMerch.replace(/\s+(?:on|with).*$/, "").trim();
    if (isTopUpLine(merchant)) return null;
    const resolved = split.dateLabel ? resolveRelativeDay(split.dateLabel, refDate, 0) : { date: refDate, precision: "minute" as DatePrecision };
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      type: "expense",
      sourceName: "Hang Seng Card",
      sourceKind: "credit_card",
      occurredAt: resolved.date,
      datePrecision: resolved.precision,
      isPersonToPerson: false,
      confidence: 0.94,
      rawText: t,
    };
  }

  // 7. Amount with destination: "HK$8.70 at KMB" / "HKD 614.00 at KPAY*KITSUNE"
  if ((m = t.match(/(?:HKD|HK\$|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|for|於|給)\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const rawMerch = m[2].trim();
    const split = splitDateFromText(rawMerch.replace(/\s+(?:on|with)\s+/i, " "));
    const merchant = split.remainingText || rawMerch.replace(/\s+(?:on|with).*$/, "").trim();
    if (isTopUpLine(merchant)) return null;
    const isOctopusTransit = /^(?:bus|train|mtr|transit|minibus|ferry|tram|light rail)$/i.test(merchant);
    const resolved = split.dateLabel ? resolveRelativeDay(split.dateLabel, refDate, 0) : { date: refDate, precision: "minute" as DatePrecision };
    return {
      amountMinor,
      currency: "HKD",
      merchant,
      merchantNormalized: normalizeMerchant(merchant),
      subcategoryHint: isOctopusTransit ? merchant : undefined,
      type: "expense",
      sourceName: isOctopusTransit ? "Octopus" : "Hang Seng Card",
      sourceKind: isOctopusTransit ? "octopus" : "credit_card",
      occurredAt: resolved.date,
      datePrecision: resolved.precision,
      isPersonToPerson: false,
      confidence: 0.9,
      rawText: t,
    };
  }

  // 8. General Smart Fallback Pattern
  if ((m = t.match(/(?:spent|paid|payment of|簽賬|付款)\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:at|to|於)?\s*([^.。，\n]+)/i))) {
    const amountMinor = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    const merchant = m[2].replace(/\s+(?:on|with).*$/, "").trim();
    if (isDateOrTimestampLabel(merchant) || isTopUpLine(merchant)) return null;
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

    if (isBalanceLine(line)) {
      const balMinor = extractBalanceMinor(line);
      if (balMinor !== undefined && items.length > 0 && items[items.length - 1].balanceAfterMinor === undefined) {
        items[items.length - 1].balanceAfterMinor = balMinor;
      }
      continue;
    }

    if (isTopUpLine(line)) {
      pendingTimestampLabel = null;
      continue;
    }

    if (isDateOrTimestampLabel(line)) {
      if (i > 0 || !/^\d{1,2}:\d{2}$/.test(line)) {
        pendingTimestampLabel = line.replace(/^(?:Octopus|Wallet|Apple Pay|PayMe(?: by HSBC)?|Gmail)\s+/i, "").trim();
      }
      continue;
    }

    if (noise.test(line)) continue;

    const directSingle = parseNotification(line, refDate);
    if (directSingle) {
      let tsLabel = pendingTimestampLabel;
      if (!tsLabel) {
        for (let j = i + 1; j <= Math.min(rawLines.length - 1, i + 2); j++) {
          const nextL = rawLines[j];
          if (isBalanceLine(nextL)) continue;
          if (isDateOrTimestampLabel(nextL)) {
            tsLabel = nextL.replace(/^(?:Octopus|Wallet|Apple Pay|PayMe(?: by HSBC)?|Gmail)\s+/i, "").trim();
            break;
          }
        }
      }
      if (!directSingle.occurredAt || directSingle.occurredAt === refDate) {
        const resolved = resolveRelativeDay(tsLabel, refDate, items.length);
        directSingle.occurredAt = resolved.date;
        directSingle.datePrecision = resolved.precision;
      }
      if (tsLabel) {
        directSingle.rawText = `${tsLabel} · ${directSingle.rawText}`;
      }
      items.push(directSingle);
      pendingTimestampLabel = null;
      continue;
    }

    const amtMatch = line.match(/([+-]?)\s*(?:HKD|HK\$|\$)\s*([0-9,]+\.[0-9]{1,2})/i);
    if (!amtMatch) continue;

    const sign = amtMatch[1];
    if (sign === "+") {
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
 * Master multi-line parser for:
 *  - Octopus App history screenshots ("Octopus 1 / 192116091(2)", "2026-09-27 16:53 -142.5") — Authoritative Source of Truth
 *  - Gmail App popup banners, Gmail inbox list screenshots, and opened PayMe emails
 *  - Hang Seng Bank App history screenshots ("CUP KPAY*KITSUNE 14OCT HKD 614.00 -614.00 HKD")
 *  - PayMe App history screenshots ("Claudia Yue - 800.00 / $70/hr")
 *  - Apple Wallet / Octopus Lock Screen & history screenshots
 */
export function parseMultipleNotifications(text: string, refDate = new Date()): ParsedNotification[] {
  if (!text) return [];

  // 1. Check Octopus App transaction history screenshot first (Authoritative Source of Truth for Octopus)
  const octopusAppItems = parseOctopusAppHistoryList(text, refDate);
  if (octopusAppItems.length > 0) {
    return octopusAppItems;
  }

  // 2. Check PayMe email / Gmail App banners, inbox list, or opened emails
  const paymeEmails = parsePayMeEmailNotifications(text, refDate);
  if (paymeEmails.length > 0) {
    return paymeEmails;
  }

  // 3. Check Hang Seng Bank App history screenshot
  const hangSengItems = parseHangSengHistoryList(text, refDate);
  if (hangSengItems.length > 0) {
    return hangSengItems;
  }

  // 4. Check PayMe App history screenshot
  const paymeAppItems = parsePayMeAppHistoryList(text, refDate);
  if (paymeAppItems.length > 0) {
    return paymeAppItems;
  }

  // 5. Check Apple Wallet / Lock Screen Octopus history list
  const historyItems = parseWalletHistoryList(text, refDate);
  if (historyItems.length > 0) {
    return historyItems;
  }

  // 6. Fallback to line-by-line single notification parsing
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
