// Text normalisation and OCR artifact cleaning used for matching merchants across sources.
// "７－Ｅｌｅｖｅｎ", "7-Eleven" and "7 ELEVEN" all normalise to "7 eleven".
// "< Octopus 1 192116091(2) Lung Fung..." strips the Octopus App header -> "Lung Fung...".
// "印 Green Minibuses" and "印 MTR Corporation Limited" strip the OCR icon artifact "印" -> "Green Minibuses", "MTR Corporation Limited".

/**
 * Strips Octopus App top header / card number prefixes (e.g. "< Octopus 1 192116091(2)")
 * and leading OCR icon misreads produced when iOS Vision OCR reads the rounded-square
 * category/transit icon on the left of Octopus App or Wallet rows as a single boxy Chinese
 * character (e.g. "印 Green Minibuses" -> "Green Minibuses").
 */
export function cleanOcrMerchantName(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    // Strip Octopus App top bar / card number header anywhere in the string (e.g. "< Octopus 1 192116091(2) ")
    .replace(
      /(?:^|\s)[<‹＜«←⬅️⌃^]*\s*(?:octopus|八達通)(?:\s+\d+)?\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/gi,
      " ",
    )
    // Strip leading "< Octopus 1" or "Octopus 1" header prefix
    .replace(
      /^[<‹＜«←⬅️]+\s*(?:octopus|八達通)(?:\s+\d+)?(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/i,
      "",
    )
    .replace(
      /^(?:octopus|八達通)\s+\d+(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?(?:\s+|$)/i,
      "",
    )
    // Strip standalone Octopus card number with check digit e.g. "192116091(2)"
    .replace(/(?:^|\s)[<‹＜«←⬅️]*\s*\b\d{7,12}\s*[\(\[\{]\d+[\)\]\}]?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/g, " ")
    // Strip leading chevrons, bullets, or geometric symbols
    .replace(/^[<‹＜«←⬅️•·▪▫◦●○■□▲△▼▽◆◇★☆⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡]+\s*/u, "")
    // Strip single boxy CJK OCR icon artifact when followed by whitespace + Latin/Chinese text, or directly before Latin text
    .replace(
      /^(?:[印日目甲由申田口回囚四皿且貝見頁車凸凹尚向同团因固國圖片币巾中内肉門間問開関]\s+|[印日目甲由申田口回囚四皿且貝見頁凸凹](?=[A-Za-z]))/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMerchant(input: string): string {
  return cleanOcrMerchantName(input)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ") // punctuation and symbols become spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes common Hong Kong merchant spelling/plural variations into a canonical key
 * so rules like "Welcome" match "Wellcome" and "Green Minibuses" match "Green Minibus".
 */
export function canonicalizeMerchantKey(input: string): string {
  return normalizeMerchant(input)
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

/**
 * Checks whether a transaction's merchant name matches a saved MerchantRule pattern,
 * accounting for OCR prefixes ("印 ", "< Octopus 1 192116091(2)"), plurals ("Minibuses" vs "Minibus"),
 * and spelling variants ("Welcome" vs "Wellcome").
 * Never allows a generic Octopus header or card number to match across unrelated merchants.
 */
export function doesMerchantMatchRule(merchant: string, rulePattern: string): boolean {
  const normMerchant = normalizeMerchant(merchant);
  const normRule = normalizeMerchant(rulePattern);
  if (!normMerchant || !normRule || normRule.length < 2) return false;
  if (GENERIC_RULE_BLACKLIST.has(normMerchant) || GENERIC_RULE_BLACKLIST.has(normRule)) return false;

  const canonMerchant = canonicalizeMerchantKey(merchant);
  const canonRule = canonicalizeMerchantKey(rulePattern);
  if (!canonMerchant || !canonRule || canonRule.length < 2) return false;
  if (GENERIC_RULE_BLACKLIST.has(canonMerchant) || GENERIC_RULE_BLACKLIST.has(canonRule)) return false;

  if (normMerchant.includes(normRule) || (normRule.length >= 3 && normRule.includes(normMerchant))) {
    return true;
  }

  if (canonMerchant.includes(canonRule) || (canonRule.length >= 3 && canonRule.includes(canonMerchant))) {
    return true;
  }

  return false;
}

/** Small stable hash (FNV 1a, 32 bit) rendered as hex. Not for security. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
