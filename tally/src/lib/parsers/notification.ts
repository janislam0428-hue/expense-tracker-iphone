// Zero-credit on-device/local notification parser.
// Designed for iPhone 14 Pro notification pop-outs (Wallet, Octopus, PayMe, bank SMS/alerts).
// Runs in <1ms without any LLM API calls, completely eliminating API token/credit costs.

import { normalizeMerchant } from "@/lib/text";
import type { DatePrecision, SourceKind, TransactionType } from "@/lib/domain";

export type ParsedNotification = {
  amountMinor: number;
  currency: string;
  merchant: string;
  merchantNormalized: string;
  counterparty?: string;
  description?: string;
  location?: string;
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

/**
 * Parses an individual notification string into structured transaction data.
 * Returns null if no recognizable transaction pattern is detected.
 */
export function parseNotification(text: string): ParsedNotification | null {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (t.length < 4) return null;

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
  if (/PayMe/i.test(t) || /(?:You(?:'ve)? paid|已付款|sent you|已向你轉賬)/i.test(t)) {
    // PayMe Sent: English
    if ((m = t.match(/(?:You(?:'ve)? paid)\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:to|at)\s*([^.。，\n]+)/i))) {
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

    // PayMe Sent: Chinese
    if ((m = t.match(/(?:已付款)\s*(?:HKD|HK\$|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:給|於)\s*([^.。，\n]+)/i))) {
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

    // PayMe Received: English & Chinese
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

  // 8. General Smart Fallback Pattern
  // Matches: "Spent HKD 120.00 at TamJai", "Paid $45 to MTR", "Payment of HK$90 at Starbucks"
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
 * Parses multi-line text (e.g. from Notification Center screenshots or batch copy-paste)
 * and returns all valid detected transactions.
 */
export function parseMultipleNotifications(text: string): ParsedNotification[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 5);
  const results: ParsedNotification[] = [];

  for (const line of lines) {
    const parsed = parseNotification(line);
    if (parsed) {
      results.push(parsed);
    }
  }

  // If line-by-line yielded nothing, try parsing the whole blob
  if (results.length === 0) {
    const single = parseNotification(text);
    if (single) results.push(single);
  }

  return results;
}
