// Text normalisation used for matching merchants across sources.
// "７－Ｅｌｅｖｅｎ", "7-Eleven" and "7 ELEVEN" all normalise to "7 eleven".

export function normalizeMerchant(input: string): string {
  return input
    .normalize("NFKC") // full width to half width, compatibility forms
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ") // punctuation and symbols become spaces
    .replace(/\s+/g, " ")
    .trim();
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
