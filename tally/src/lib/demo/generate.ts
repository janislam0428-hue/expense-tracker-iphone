// Deterministic demo data: about 24 months of realistic Hong Kong spending.
//
// Built in seasonal patterns (so Phase 6 has something real to detect):
//   * Beauty & Cosmetics jumps every Q4 (October to December, peaking at 11.11),
//     well above the 2,000 monthly alert, in both 2024 and 2025, and again in 2026.
//   * Gifts & Red Packets spike around Lunar New Year and in December.
//   * Travel lands in Q3 in both 2025 (Japan) and 2026 (Taiwan).
// Octopus fares mirror the user's real ones (8.70 bus, 15.30 train...) with a
// running balance and top ups, so balance chain logic can be exercised.
//
// Pure function: no database access, same output for the same `now` and `seed`.
import { addZonedDays, zonedDate, zonedParts } from "@/lib/time";
import { normalizeMerchant, shortHash } from "@/lib/text";
import type { DatePrecision, TransactionType } from "@/lib/domain";

export type DemoTx = {
  occurredAt: Date;
  datePrecision: DatePrecision;
  amountMinor: number;
  merchant: string;
  merchantNormalized: string;
  counterparty?: string;
  description?: string;
  location?: string;
  category: string | null;
  subcategory?: string;
  source: string;
  type: TransactionType;
  purpose: string | null;
  balanceAfterMinor?: number;
  externalRef?: string;
  notes?: string;
  isPersonToPerson: boolean;
};

export type DemoRule = { pattern: string; category: string; subcategory?: string; purpose: string };

/** Merchants the demo pretends you already saved rules for. */
export const DEMO_RULES: DemoRule[] = [
  { pattern: "7 eleven", category: "Groceries", subcategory: "Convenience store", purpose: "Personal" },
  { pattern: "circle k", category: "Groceries", subcategory: "Convenience store", purpose: "Personal" },
  { pattern: "pacific coffee", category: "Food", subcategory: "Cafe", purpose: "Personal" },
  { pattern: "starbucks", category: "Food", subcategory: "Cafe", purpose: "Personal" },
  { pattern: "parknshop", category: "Groceries", subcategory: "Supermarket", purpose: "Personal" },
  { pattern: "wellcome", category: "Groceries", subcategory: "Supermarket", purpose: "Personal" },
  { pattern: "uniqlo", category: "Personal Expense", subcategory: "Leisure clothing", purpose: "Personal" },
  { pattern: "netflix", category: "Subscription", purpose: "Personal" },
  { pattern: "spotify", category: "Subscription", purpose: "Personal" },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof makeRng>;

function makeRng(seed: number) {
  const r = mulberry32(seed);
  return {
    next: r,
    chance: (p: number) => r() < p,
    int: (min: number, max: number) => Math.floor(min + r() * (max - min + 1)),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)],
    /** Amount in minor units between min and max dollars, rounded to `step` dollars. */
    amount: (min: number, max: number, step = 0.1) => {
      const v = min + r() * (max - min);
      return Math.round(Math.round(v / step) * step * 100);
    },
  };
}

const RESTAURANTS = [
  "Tsui Wah 翠華餐廳",
  "Din Tai Fung 鼎泰豐",
  "Yat Lok 一樂燒鵝",
  "Ichiran 一蘭",
  "Ho Lee Fook",
  "Mott 32 卅二公館",
  "Kam's Roast Goose 甘牌燒鵝",
];
const CHEAP_EATS = ["美心MX Maxim's MX", "大家樂 Café de Coral", "譚仔三哥米線 TamJai SamGor", "Kam Kee Cafe 金記冰室"];
const BEAUTY_EVERYDAY = ["Sasa 莎莎", "Bonjour 卓悅", "Mannings 萬寧", "Watsons 屈臣氏"];
const BEAUTY_Q4 = ["Sephora", "Lane Crawford Beauty", "SK-II", "Shiseido", "Sasa 莎莎", "Bonjour 卓悅"];
const DEPT = ["SOGO 崇光", "Lane Crawford", "Harvey Nichols", "Wing On 永安"];
const FRIENDS = ["Karen Chan", "Michael Wong", "Joyce Lam", "Claudia Yue"];
const LNY: Record<number, [number, number]> = { 2025: [1, 29], 2026: [2, 17] };

export function generateDemo(now: Date, seed = 20261011): { transactions: DemoTx[]; rules: DemoRule[] } {
  const rng = makeRng(seed);
  const out: DemoTx[] = [];
  const nowParts = zonedParts(now);
  // Start on the first day of the month 24 months ago.
  let startYear = nowParts.year;
  let startMonth = nowParts.month - 24;
  while (startMonth < 1) {
    startMonth += 12;
    startYear -= 1;
  }
  let day = zonedDate(startYear, startMonth, 1);

  let octopusBalance = 41230;
  let paymeBalance = 80000;

  const push = (tx: Omit<DemoTx, "merchantNormalized" | "datePrecision"> & { datePrecision?: DatePrecision }) => {
    if (tx.occurredAt.getTime() > now.getTime()) return;
    out.push({ datePrecision: "minute", ...tx, merchantNormalized: normalizeMerchant(tx.merchant) });
  };

  const at = (d: Date, h: number, m: number) => {
    const p = zonedParts(d);
    return zonedDate(p.year, p.month, p.day, h, m);
  };

  type OctopusFields = Pick<DemoTx, "merchant" | "category" | "subcategory" | "purpose"> & Partial<DemoTx>;
  // Octopus taps are queued per day and applied in time order so the running
  // balance follows the clock, exactly like the real card.
  let octopusQueue: Array<{ when: Date; amountMinor: number; fields: OctopusFields }> = [];
  const octopus = (when: Date, amountMinor: number, fields: OctopusFields) => {
    octopusQueue.push({ when, amountMinor, fields });
  };
  const flushOctopus = () => {
    octopusQueue.sort((a, b) => a.when.getTime() - b.when.getTime());
    for (const q of octopusQueue) applyOctopus(q.when, q.amountMinor, q.fields);
    octopusQueue = [];
  };

  const applyOctopus = (when: Date, amountMinor: number, fields: OctopusFields) => {
    if (when.getTime() > now.getTime()) return;
    if (octopusBalance - amountMinor < 3500) {
      // Wallet top up to a round 600, like the real "+HK$621.70 Credit" sample.
      const topUp = 60000 - octopusBalance;
      octopusBalance = 60000;
      push({
        occurredAt: new Date(when.getTime() - 30_000), // just before the tap that needed it
        amountMinor: topUp,
        merchant: "Octopus top up",
        description: "Credit",
        category: "Top ups & Transfers",
        source: "Octopus",
        type: "top_up",
        purpose: null,
        balanceAfterMinor: octopusBalance,
        isPersonToPerson: false,
      });
    }
    octopusBalance -= amountMinor;
    push({
      occurredAt: when,
      amountMinor,
      source: "Octopus",
      type: "expense",
      balanceAfterMinor: octopusBalance,
      isPersonToPerson: false,
      ...fields,
    });
  };

  const payme = (when: Date, amountMinor: number, fields: Omit<DemoTx, "occurredAt" | "amountMinor" | "source" | "merchantNormalized" | "datePrecision">) => {
    if (when.getTime() > now.getTime()) return;
    if (fields.type === "income") paymeBalance += amountMinor;
    else {
      if (paymeBalance - amountMinor < 10000) {
        paymeBalance += 100000;
        push({
          occurredAt: new Date(when.getTime() - 40 * 60_000),
          amountMinor: 100000,
          merchant: "PayMe top up",
          description: "From Hang Seng Bank Limited",
          category: "Top ups & Transfers",
          source: "PayMe",
          type: "top_up",
          purpose: null,
          isPersonToPerson: false,
        });
      }
      paymeBalance -= amountMinor;
    }
    push({
      occurredAt: when,
      amountMinor,
      source: "PayMe",
      externalRef: fields.isPersonToPerson ? undefined : uuidish(rng),
      ...fields,
    });
  };

  const card = (when: Date, amountMinor: number, fields: Omit<DemoTx, "occurredAt" | "amountMinor" | "source" | "merchantNormalized" | "datePrecision" | "type" | "isPersonToPerson"> & { type?: TransactionType }) =>
    push({ occurredAt: when, amountMinor, source: "Hang Seng Card", type: "expense", isPersonToPerson: false, ...fields });

  const cash = (when: Date, amountMinor: number, fields: Omit<DemoTx, "occurredAt" | "amountMinor" | "source" | "merchantNormalized" | "datePrecision" | "type" | "isPersonToPerson"> & { datePrecision?: DatePrecision }) =>
    push({ occurredAt: when, amountMinor, source: "Cash", type: "expense", isPersonToPerson: false, ...fields });

  while (day.getTime() <= now.getTime()) {
    const p = zonedParts(day);
    const weekday = p.weekday; // 0 Sun
    const isWeekend = weekday === 0 || weekday === 6;
    const q4 = p.month >= 10;

    // ---------- Octopus: transport ----------
    if (!isWeekend && rng.chance(0.84)) {
      octopus(at(day, 8, rng.int(5, 35)), 870, { merchant: "Bus", category: "Transport", subcategory: "Public transport", purpose: "Personal", location: "Kwai Chung, New Territories" });
      octopus(at(day, 8, rng.int(40, 59)), 1530, { merchant: "Train", category: "Transport", subcategory: "Public transport", purpose: "Personal" });
      const eveningH = rng.int(17, 19);
      octopus(at(day, eveningH, rng.int(0, 20)), 1580, { merchant: "Train", category: "Transport", subcategory: "Public transport", purpose: "Personal" });
      if (rng.chance(0.3)) octopus(at(day, eveningH, rng.int(21, 29)), 330, { merchant: "Transit", category: "Transport", subcategory: "Public transport", purpose: "Personal" });
      octopus(at(day, eveningH, rng.int(31, 50)), 820, { merchant: "Bus", category: "Transport", subcategory: "Public transport", purpose: "Personal", location: "Cheung Sha Wan, Kowloon" });
    } else {
      const trips = rng.int(0, 3);
      for (let i = 0; i < trips; i++) {
        if (rng.chance(0.75)) {
          octopus(at(day, rng.int(10, 21), rng.int(0, 59)), rng.pick([490, 740, 1090, 1360, 1530, 2240]), { merchant: "Train", category: "Transport", subcategory: "Public transport", purpose: "Personal" });
        } else {
          octopus(at(day, rng.int(10, 21), rng.int(0, 59)), rng.pick([640, 980]), { merchant: "Minibus", category: "Transport", subcategory: "Public transport", purpose: "Personal" });
        }
      }
    }

    // ---------- Octopus: small retail ----------
    if (rng.chance(0.32)) {
      const m = rng.pick(["7-Eleven", "Circle K OK便利店"]);
      octopus(at(day, rng.int(7, 22), rng.int(0, 59)), rng.amount(12, 48), { merchant: m, category: "Groceries", subcategory: "Convenience store", purpose: "Personal" });
    }
    if (!isWeekend && rng.chance(0.28)) {
      const m = rng.pick(["Pacific Coffee", "Starbucks"]);
      octopus(at(day, rng.int(9, 15), rng.int(0, 59)), rng.amount(38, 56), { merchant: m, category: "Food", subcategory: "Cafe", purpose: "Personal" });
    }
    if (!isWeekend && rng.chance(0.22)) {
      octopus(at(day, 12, rng.int(5, 55)), rng.amount(38, 72), { merchant: rng.pick(CHEAP_EATS), category: "Food", subcategory: "Fast food", purpose: "Personal" });
    }

    // ---------- PayMe ----------
    if (rng.chance(0.1)) {
      const friend = rng.pick(FRIENDS);
      const isGift = rng.chance(0.15);
      payme(at(day, rng.int(12, 23), rng.int(0, 59)), rng.amount(45, 380, 1), {
        merchant: friend,
        counterparty: friend,
        description: isGift ? "Birthday gift" : rng.pick(["Dinner", "Hotpot", "Movie", "Payment", "Brunch"]),
        category: "Transfers to People",
        type: "expense",
        purpose: isGift ? "Gift" : "Leisure",
        isPersonToPerson: true,
      });
    }
    if (rng.chance(0.045)) {
      const friend = rng.pick(FRIENDS);
      payme(at(day, rng.int(12, 23), rng.int(0, 59)), rng.amount(30, 250, 1), {
        merchant: friend,
        counterparty: friend,
        description: rng.pick(["Hola", "Thanks for dinner", "Taxi", "Payment"]),
        category: "Money Received",
        type: "income",
        purpose: "Reimbursement",
        isPersonToPerson: true,
      });
    }
    if (p.day === 1) {
      payme(at(day, 20, 15), 150000, {
        merchant: "Mum",
        counterparty: "Mum",
        description: "Monthly",
        category: "Transfers to People",
        type: "expense",
        purpose: "Family",
        isPersonToPerson: true,
      });
    }
    if (rng.chance(0.05)) {
      payme(at(day, rng.int(11, 19), rng.int(0, 59)), rng.amount(58, 288), {
        merchant: "chree patisserie CH3",
        description: "Payment",
        category: "Food",
        subcategory: "Bakery",
        type: "expense",
        purpose: rng.chance(0.25) ? "Gift" : "Personal",
        isPersonToPerson: false,
      });
    }
    if (rng.chance(0.05)) {
      payme(at(day, rng.int(19, 23), rng.int(0, 59)), rng.amount(120, 680, 1), {
        merchant: "HKTVmall",
        category: "Personal Expense",
        type: "expense",
        purpose: "Personal",
        isPersonToPerson: false,
      });
    }

    // ---------- Credit card ----------
    if (weekday === 6 || (weekday === 3 && rng.chance(0.4))) {
      card(at(day, rng.int(11, 19), rng.int(0, 59)), rng.amount(120, 560), {
        merchant: rng.pick(["PARKnSHOP 百佳", "Wellcome 惠康"]),
        category: "Groceries",
        subcategory: "Supermarket",
        purpose: "Personal",
      });
    }
    if ((weekday === 5 || weekday === 6) && rng.chance(0.36)) {
      card(at(day, rng.int(19, 21), rng.int(0, 59)), rng.amount(160, 620, 1), {
        merchant: rng.pick(RESTAURANTS),
        category: "Food",
        subcategory: "Restaurant",
        purpose: rng.chance(0.7) ? "Leisure" : "Personal",
      });
    }
    if (!isWeekend && rng.chance(0.045)) {
      card(at(day, 13, rng.int(0, 30)), rng.amount(220, 640, 1), {
        merchant: rng.pick(RESTAURANTS),
        category: "Food",
        subcategory: "Restaurant",
        purpose: "Work",
        notes: "Client lunch",
      });
    }
    if (p.day === 5) card(at(day, 3, 12), 9300, { merchant: "Netflix", category: "Subscription", purpose: "Personal" });
    if (p.day === 12) card(at(day, 4, 40), 6800, { merchant: "Spotify", category: "Subscription", purpose: "Personal" });
    if (p.day === 8) card(at(day, 9, 0), 19800, { merchant: "CSL Mobile", category: "Bills", purpose: "Personal" });
    if (p.day === 15) card(at(day, 9, 0), 16800, { merchant: "HKBN Broadband", category: "Bills", purpose: "Personal" });
    if (p.day === 18 && p.month % 2 === 0) {
      const summer = p.month >= 6 && p.month <= 9;
      card(at(day, 10, 0), rng.amount(summer ? 520 : 280, summer ? 760 : 460, 1), { merchant: "CLP Power 中電", category: "Bills", purpose: "Personal" });
    }
    if (p.day === 22) card(at(day, 10, 0), rng.amount(120, 260, 1), { merchant: "Towngas 煤氣", category: "Bills", purpose: "Personal" });

    if (rng.chance(0.035)) {
      card(at(day, rng.int(12, 20), rng.int(0, 59)), rng.amount(99, 499, 10), { merchant: "UNIQLO", category: "Personal Expense", subcategory: "Leisure clothing", purpose: "Personal" });
    }
    if (rng.chance(0.008)) {
      card(at(day, rng.int(12, 20), rng.int(0, 59)), rng.amount(149, 299, 10), { merchant: "UNIQLO", category: "Personal Expense", subcategory: "Leisure clothing", purpose: "Personal", type: "refund", notes: "Returned item" });
    }
    if (rng.chance(0.012)) {
      card(at(day, rng.int(12, 20), rng.int(0, 59)), rng.amount(200, 1200, 10), { merchant: rng.pick(DEPT), category: "Personal Expense", purpose: "Personal" });
    }
    if (rng.chance(0.06)) {
      card(at(day, rng.int(19, 22), rng.int(0, 59)), rng.amount(95, 130, 1), { merchant: "Broadway Cinema 百老匯", category: "Personal Expense", purpose: "Leisure" });
    }
    if (rng.chance(0.012)) {
      card(at(day, rng.int(9, 18), rng.int(0, 59)), rng.amount(350, 520, 10), { merchant: "Quality HealthCare", category: "Personal Expense", purpose: "Personal" });
    }
    if (rng.chance(0.03)) {
      card(at(day, rng.int(9, 21), rng.int(0, 59)), rng.amount(40, 180), { merchant: "Watsons 屈臣氏", category: "Personal Expense", purpose: "Personal" });
    }

    // ---------- Beauty: modest all year, big in Q4 ----------
    const beautyChance = q4 ? (p.month === 11 && p.day >= 8 && p.day <= 12 ? 0.75 : 0.22) : 0.03;
    if (rng.chance(beautyChance)) {
      const big = q4;
      card(at(day, rng.int(12, 21), rng.int(0, 59)), big ? rng.amount(180, 820, 1) : rng.amount(80, 320, 1), {
        merchant: big ? rng.pick(BEAUTY_Q4) : rng.pick(BEAUTY_EVERYDAY),
        category: "Personal Expense",
        subcategory: "Makeup",
        purpose: p.month === 12 && rng.chance(0.35) ? "Gift" : "Personal",
      });
    }

    // ---------- December gifts ----------
    if (p.month === 12 && p.day >= 10 && p.day <= 23 && rng.chance(0.28)) {
      card(at(day, rng.int(13, 21), rng.int(0, 59)), rng.amount(200, 800, 10), { merchant: rng.pick(DEPT), category: "Personal Expense", purpose: "Gift", notes: "Christmas" });
    }

    // ---------- Cash ----------
    if (weekday === 0 && rng.chance(0.6)) {
      cash(at(day, 10, rng.int(0, 59)), rng.amount(30, 120, 1), { merchant: "Wet market 街市", category: "Groceries", subcategory: "Wet market", purpose: "Personal", datePrecision: "date_only" });
    }

    flushOctopus();
    day = addZonedDays(day, 1);
  }

  // ---------- Lunar New Year red packets ----------
  for (const [yearStr, [m, d]] of Object.entries(LNY)) {
    const y = Number(yearStr);
    const lny = zonedDate(y, m, d, 18, 0);
    const amounts = [rng.amount(800, 1200, 10), rng.amount(700, 1000, 10), rng.amount(500, 800, 10)];
    amounts.forEach((amt, i) => {
      cash(addZonedDays(lny, -(i * 2 + 1)), amt, {
        merchant: "Red packets 利是",
        category: "Gift",
        purpose: i === 0 ? "Family" : "Gift",
        notes: "Lunar New Year",
        datePrecision: "date_only",
      });
    });
  }

  // ---------- Travel, Q3 in two different years ----------
  const travel: Array<[number, number, number, number, string, string]> = [
    [2025, 6, 12, 428000, "Cathay Pacific", "Japan trip"],
    [2025, 7, 18, 396000, "Booking.com", "Japan trip, hotel"],
    [2025, 7, 21, 118000, "Don Quijote ドン・キホーテ", "Japan trip"],
    [2026, 7, 6, 188000, "HK Express", "Taiwan trip"],
    [2026, 8, 14, 245000, "Agoda", "Taiwan trip, hotel"],
    [2026, 8, 16, 86000, "Eslite 誠品", "Taiwan trip"],
  ];
  for (const [y, m, d, amt, merchant, note] of travel) {
    card(zonedDate(y, m, d, 14, 30), amt, { merchant, category: "Travel Expense", purpose: "Leisure", notes: note });
  }

  // One off course fee
  card(zonedDate(2026, 3, 3, 11, 15), 320000, { merchant: "HKU SPACE", category: "Personal Expense", purpose: "Work", notes: "Course fee" });

  out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { transactions: out, rules: DEMO_RULES };
}

function uuidish(rng: Rng): string {
  const hex = () => Math.floor(rng.next() * 16).toString(16);
  const part = (n: number) => Array.from({ length: n }, hex).join("");
  return `${part(8)}-${part(4)}-4${part(3)}-${part(4)}-${part(12)}`;
}

export function demoFingerprint(tx: DemoTx, index: number): string {
  return `demo:${shortHash(`${tx.source}|${tx.occurredAt.toISOString()}|${tx.amountMinor}|${tx.merchantNormalized}|${index}`)}`;
}
