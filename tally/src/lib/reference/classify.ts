import { normalizeMerchant } from "@/lib/text";

export type Classification = { category: string; subcategory?: string };

// Conservative merchant hints only. A supermarket, mall or pharmacy does not
// tell us whether a purchase was a gift, social expense or a particular product.
export function classifyMerchant(merchant: string): Classification | null {
  const m = normalizeMerchant(merchant);
  const rules: [RegExp, string, string?][] = [
    [/\buber eats\b|\bfoodpanda\b|\bdeliveroo\b/, "Food", "Food delivery"],
    [/\btrain\b|\bmtr\b|\btransit\b|\bbus\b|\bkmb\b|\bcitybus\b|\bminibus\b|\bferry\b|\btram\b|港鐵|巴士|九巴|小巴|電車|渡輪/, "Transport", "Public transport"],
    [/\buber\b|\btaxi\b|的士/, "Transport", "Taxi/Uber"],
    [/\bopenai\b|\bchatgpt\b|\bperplexity\b|\banthropic\b|\bclaude\b/, "Subscription", "AI"],
    [/\bnetflix\b|\bspotify\b|\byoutube premium\b|\bdisney plus\b/, "Subscription", "Streaming"],
    [/\bgym membership\b|\bpure fitness\b|\bfitness first\b|\banytime fitness\b/, "Subscription", "Gym Membership"],
    [/\bclp\b|\btowngas\b|\bhk electric\b|中電|煤氣/, "Bills", "Utilities"],
    [/\bhkbn\b|\bnetvigator\b|\bbroadband\b/, "Bills", "Internet"],
    [/\bcsl\b|\bsmartone\b|\bchina mobile\b/, "Bills", "Phone"],
    [/\bprudential\b|\bmanulife\b|\baia insurance\b|保險/, "Bills", "Insurance"],
    [/\bparknshop\b|\bwellcome\b|\bsupermarket\b|百佳|惠康/, "Groceries", "Supermarket"],
    [/\b7 eleven\b|\bcircle k\b|便利店/, "Groceries", "Convenience store"],
    [/\bwet market\b|街市/, "Groceries", "Wet market"],
    [/\bstarbucks\b|\bcoffee\b|\bcafe\b/, "Food", "Cafe"],
    [/\bmcdonalds?\b|\bkfc\b|\bburger king\b/, "Food", "Fast food"],
    [/\bbakery\b|麵包/, "Food", "Bakery"],
    [/\brestaurant\b|\btsui wah\b|\btamjai\b|\bdin tai fung\b/, "Food", "Restaurant"],
    [/\bsupplements?\b|\bvitamins?\b/, "Personal Expense", "Health & supplements"],
    [/\bfacial\b|\bnail salon\b|\bmanicure\b|\bpedicure\b|美容院|美甲/, "Personal Expense", "Beauty treatments"],
    [/\bwatsons\b|\bmannings\b|\buniqlo\b|\bhktvmall\b|屈臣氏|萬寧/, "Personal Expense"],
    [/^purchase$/, "Other"],
  ];
  const rule = rules.find(([pattern]) => pattern.test(m));
  return rule ? { category: rule[1], subcategory: rule[2] } : null;
}
