import { normalizeMerchant } from "@/lib/text";

export type Classification = {
  category: string;
  subcategory?: string;
  /**
   * True when the merchant name had additional unknown words alongside a generic keyword
   * (e.g. "yummy food minibus") rather than being a known Hong Kong brand or pure transit string
   * (like "Green Minibuses", "印 Green Minibus", "MTR Corporation Limited", or "Welcome").
   */
  isKeywordFallback?: boolean;
};

function withFallbackFlag(c: { category: string; subcategory?: string }, isKeywordFallback: boolean): Classification {
  const out: Classification = { category: c.category, subcategory: c.subcategory };
  Object.defineProperty(out, "isKeywordFallback", {
    value: isKeywordFallback,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return out;
}

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
    .replace(
      /(?:^|\s)[<‹＜«←⬅️⌃^]*\s*(?:octopus|八達通)(?:\s+\d+)?\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/gi,
      " ",
    )
    .replace(
      /^[<‹＜«←⬅️]+\s*(?:octopus|八達通)(?:\s+\d+)?(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/i,
      "",
    )
    .replace(
      /^(?:octopus|八達通)\s+\d+(?:\s+\d{6,12}(?:\s*[\(\[\{]\d+[\)\]\}]?)?)?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?(?:\s+|$)/i,
      "",
    )
    .replace(/(?:^|\s)[<‹＜«←⬅️]*\s*\b\d{7,12}\s*[\(\[\{]\d+[\)\]\}]?(?:\s*(?:\(i\)|ⓘ|\+|⊕))?\s*/g, " ")
    .replace(/^[<‹＜«←⬅️•·▪▫◦●○■□▲△▼▽◆◇★☆⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡]+\s*/u, "")
    .replace(
      /^(?:[印日目甲由申田口回囚四皿且貝見頁車凸凹尚向同团因固國圖片币巾中内肉門間問開関]\s+|[印日目甲由申田口回囚四皿且貝見頁凸凹](?=[A-Za-z]))/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips OCR icon prefixes ("印 "), Octopus headers ("< Octopus 1 192116091(2)"),
 * payment processor prefixes (e.g. "CUP", "KPAY*", "BBMSL*", "VISA"),
 * and corporate suffixes ("(GROUP) LIMITED", "LIMITED", "LTD", branch codes)
 * so keyword matching and web searches find the actual store or restaurant name in Hong Kong.
 */
export function cleanMerchantForSearch(merchant: string): string {
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

const PURE_TRANSIT_WORDS = new Set([
  "green",
  "red",
  "public",
  "light",
  "minibus",
  "minibuses",
  "bus",
  "buses",
  "mtr",
  "train",
  "transit",
  "rail",
  "railway",
  "kmb",
  "citybus",
  "nwfb",
  "lwb",
  "nlb",
  "ferry",
  "star",
  "tram",
  "tramways",
  "peak",
  "taxi",
  "cab",
  "uber",
  "didi",
  "octopus",
  "route",
  "station",
  "line",
  "fare",
  "港鐵",
  "巴士",
  "九巴",
  "城巴",
  "新巴",
  "龍運",
  "小巴",
  "專線小巴",
  "公共小巴",
  "綠色小巴",
  "紅色小巴",
  "電車",
  "渡輪",
  "天星小輪",
  "輕鐵",
  "的士",
  "優步",
]);

export function isPureTransitMerchant(merchant: string): boolean {
  const cleaned = normalizeMerchant(cleanMerchantForSearch(merchant));
  if (!cleaned) return false;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((tok) => PURE_TRANSIT_WORDS.has(tok));
}

// Fast local merchant & keyword classification rules for Hong Kong transit, retail, dining, and bills.
export function classifyMerchant(merchant: string): Classification | null {
  const cleanedRaw = cleanOcrMerchantName(merchant);
  const cleanedSearch = cleanMerchantForSearch(cleanedRaw);
  const m = ` ${normalizeMerchant(cleanedRaw)} ${normalizeMerchant(cleanedSearch)} `;
  if (!m.trim()) return null;

  // 1. Pure transit check (e.g. "印 Green Minibus", "Green Minibuses", "印 MTR Corporation Limited", "KMB", "Star Ferry", "Taxi")
  if (isPureTransitMerchant(cleanedRaw)) {
    if (/(?:^|\s)(?:uber|taxi|cab|didi)(?:\s|$)|的士|優步/.test(m)) {
      return withFallbackFlag({ category: "Transport", subcategory: "Taxi/Uber" }, false);
    }
    return withFallbackFlag({ category: "Transport", subcategory: "Public transport" }, false);
  }

  // 2. Direct Known Hong Kong Brands & Chains (0ms, high-confidence exact brand match)
  const brandRules: [RegExp, string, string?][] = [
    [/uber eats|foodpanda|deliveroo|keeta/, "Food", "Food delivery"],
    [
      /mtr corporation|hk tramways|star ferry|citybus|(?:^|\s)kmb(?:\s|$)|港鐵|九巴|城巴|專線小巴|天星小輪/,
      "Transport",
      "Public transport",
    ],
    [/(?:^|\s)(?:shell|caltex|esso|sinopec|hke toll|autotoll)(?:\s|$)/, "Bills", "Car"],
    [/(?:^|\s)(?:openai|chatgpt|perplexity|anthropic|claude|midjourney|cursor)(?:\s|$)/, "Subscription", "AI"],
    [
      /netflix|spotify|youtube premium|disney plus|disney\+|apple music|apple tv|now tv|kkbox|viu/,
      "Subscription",
      "Streaming",
    ],
    [/icloud|google one|dropbox|1password|notion|canva|adobe/, "Subscription", "App"],
    [
      /pure fitness|fitness first|anytime fitness|24 7 fitness|24\/7 fitness|efx|go24|snap fitness|classpass|hong yip services/,
      "Subscription",
      "Gym Membership",
    ],
    [/(?:^|\s)(?:clp|towngas|hk electric|water supplies)(?:\s|$)|中電|煤氣|港燈|水務署/, "Bills", "Utilities"],
    [/(?:^|\s)(?:hkbn|netvigator|hgc|pccw)(?:\s|$)|網上行|香港寬頻/, "Bills", "Internet"],
    [
      /(?:^|\s)(?:csl|smartone|china mobile|3hk|club sim|sosim|sun mobile|1010|birdie)(?:\s|$)|數碼通|中國移動/,
      "Bills",
      "Phone",
    ],
    [
      /(?:^|\s)(?:prudential|manulife|aia|fwd|axa|bupa|cigna|hsbc life|hang seng insurance)(?:\s|$)|保誠|宏利|友邦|富衛/,
      "Bills",
      "Insurance",
    ],
    [
      /parknshop|(?:^|\s)wel+come(?:\s|$)|wellcome|market\s*place|3hreesixty|don don donki|donki|(?:^|\s)yata(?:\s|$)|(?:^|\s)aeon(?:\s|$)|city\s*super|marks\s*&\s*spencer|m\s*&\s*s food|sogo supermarket|dai sang|759 store|prizemart|best mart 360|(?:^|\s)fusion(?:\s|$)|百佳|惠康|一田|驚安|大生|阿信屋|優品360/,
      "Groceries",
      "Supermarket",
    ],
    [/7\s*eleven|circle k|ok便利店|(?:^|\s)vango(?:\s|$)/, "Groceries", "Convenience store"],
    [
      /starbucks|pacific coffee|kitsune|arabica|noc coffee|blue bottle|cupping room|pret a manger|(?:^|\s)pret(?:\s|$)|cotti|luckin|heytea|nayuki|gong cha|(?:^|\s)koi(?:\s|$)|tenren|sharetea|chagee|喜茶|霸王茶姬|天仁茗茶/,
      "Food",
      "Cafe",
    ],
    [
      /mcdonalds?|kfc|burger king|mos burger|shake shack|five guys|wendys?|subway|jollibee|pizza hut|(?:^|\s)phd(?:\s|$)|yoshinoya|sukiya|matsuya|cafe de coral|fairwood|maxims? mx|麥當勞|肯德基|大家樂|大快活|吉野家|食其家|松屋/,
      "Food",
      "Fast food",
    ],
    [
      /chree|maxims? cakes?|arome|chateraise|bakehouse|vission|saint honore|taipan|kee wah|lady m|lucullus|twif|美心西餅|東海堂|聖安娜|奇華/,
      "Food",
      "Bakery",
    ],
    [
      /shari shari|hui lau shan|honeymoon dessert|許留山|滿記甜品|聰嫂|佳佳甜品|地茂館|松記糖水|甜姨姨|百味堂/,
      "Food",
      "Dessert",
    ],
    [
      /tsui wah|tamjai|samgor|din tai fung|sushiro|genki|senryo|ichiran|譚仔|三哥|翠華|壽司郎|元氣|千兩|一蘭/,
      "Food",
      "Restaurant",
    ],
    [/neway|red mr|cosmos/, "Gathering", "Gathering activity"],
    [/iherb|(?:^|\s)gnc(?:\s|$)|catalo|fancl|blackmores|swisse/, "Personal Expense", "Health & supplements"],
    [
      /(?:^|\s)sa\s*sa(?:\s|$)|sasa|sephora|innisfree|olive young|bonjour|colourmix|kiehls?|aesop|loccitane|shiseido|lancome|estee lauder|sk ii|clinique|莎莎|卓悅|卡萊美/,
      "Personal Expense",
      "Skincare",
    ],
    [/mac cosmetics|nars|charlotte tilbury|chanel beauty|dior beauty|shu uemura/, "Personal Expense", "Makeup"],
    [
      /optical centre|owndays|zoff|egg optical|puyi|optical 88|charles\s*&\s*keith|pandora|swarovski|眼鏡88|溥儀眼鏡/,
      "Personal Expense",
      "Accessories",
    ],
    [/lung fung|matsumoto kiyoshi|matsukiyo|龍豐|松本清/, "Personal Expense", "Daily essentials"],
    [/watsons|mannings|屈臣氏|萬寧/, "Personal Expense", undefined],
    [/uniqlo|無印良品|muji/, "Personal Expense", undefined],
    [
      /zara|(?:^|\s)gu(?:\s|$)|h\s*&\s*m|(?:^|\s)cos(?:\s|$)|mango|cotton on|nike|adidas|new balance|lululemon|arcteryx|decathlon|lane crawford|(?:^|\s)sogo(?:\s|$)/,
      "Personal Expense",
      "Leisure clothing",
    ],
    [
      /apple store|fortress|broadway|sony|samsung|dyson|yoho|price com|豐澤|百老匯/,
      "Personal Expense",
      "Electronics",
    ],
    [/ikea|francfranc|pricerate|japan home|jhc|nitori|log on|citylink|宜家|實惠|日本城/, "Personal Expense", "Home"],
    [
      /mcl|broadway circuit|emperor cinemas|golden harvest|disney|ocean park|(?:^|\s)m\+(?:\s|$)|palace museum|klook|pop mart|海洋公園|迪士尼/,
      "Personal Expense",
      "Leisure activities",
    ],
    [
      /eslite|joint publishing|commercial press|chung hwa|udemy|coursera|誠品|三聯|商務印書館|中華書局/,
      "Personal Expense",
      "Learning & development",
    ],
    [/hktvmall|taobao|tmall|jd com|pinduoduo|amazon|淘寶|天貓|京東|拼多多/, "Personal Expense", "Daily essentials"],
    [
      /cathay pacific|hk express|hong kong airlines|greater bay airlines|國泰|香港快運|香港航空/,
      "Travel Expense",
      "Flights",
    ],
    [/agoda|booking com|trip com|expedia|airbnb|hotels? com|marriott|hyatt|hilton|shangri la/, "Travel Expense", "Accommodation"],
  ];

  const brandMatch = brandRules.find(([pattern]) => pattern.test(m));
  if (brandMatch) {
    return withFallbackFlag({ category: brandMatch[1], subcategory: brandMatch[2] }, false);
  }

  // 3. Keyword Detection Rules (routes any merchant containing keywords like "minibus", "bus", "mtr",
  //    "supermarket", "bakery", "dessert", "cafe", "optical", "pharmacy", etc. to its matching category suggestion.)
  const keywordRules: [RegExp, string, string?][] = [
    [
      /minibus|(?:^|\s)(?:train|mtr|transit|bus|buses|ferry|tram|light rail)(?:\s|$)|巴士|小巴|港鐵|電車|渡輪|輕鐵/,
      "Transport",
      "Public transport",
    ],
    [/(?:^|\s)(?:uber|taxi|cab|didi)(?:\s|$)|的士|優步/, "Transport", "Taxi/Uber"],
    [/(?:^|\s)(?:tunnel|parking|car park)(?:\s|$)|隧道|停車場/, "Bills", "Car"],
    [/gym membership|(?:^|\s)(?:gym|fitness)(?:\s|$)/, "Subscription", "Gym Membership"],
    [/(?:^|\s)broadband(?:\s|$)/, "Bills", "Internet"],
    [/(?:^|\s)insurance(?:\s|$)|保險/, "Bills", "Insurance"],
    [/(?:^|\s)(?:supermarket|grocery|groceries|food market|mart)(?:\s|$)|超市|超級市場|士多/, "Groceries", "Supermarket"],
    [/convenience store|便利店/, "Groceries", "Convenience store"],
    [/wet market|fresh market|街市|鮮活市場/, "Groceries", "Wet market"],
    [/bakery|patisserie|boulangerie|pastry|pastries|croissant|(?:^|\s)cake(?:s)?(?:\s|$)|麵包|餅店|西餅|烘焙/, "Food", "Bakery"],
    [
      /(?:^|\s)(?:dessert|desserts|gelato|ice cream|froyo|kakigori|shaved ice|sweet soup|pudding|souffle|waffle|crepe)(?:\s|$)|甜品|糖水|雪糕|刨冰|豆腐花|芋圓|仙草/,
      "Food",
      "Dessert",
    ],
    [/(?:^|\s)(?:coffee|cafe|café|tea|boba|latte|espresso|matcha)(?:\s|$)|咖啡|茶飲|手搖飲/, "Food", "Cafe"],
    [/fast food|(?:^|\s)burger(?:\s|$)|快餐|漢堡/, "Food", "Fast food"],
    [
      /restaurant|ramen|sushi|izakaya|bistro|kitchen|trattoria|steakhouse|hotpot|yakiniku|bbq|dim sum|noodle|dumpling|cha chaan teng|(?:^|\s)(?:food|yummy|dining|eatery|canteen|thai|vietnamese|korean|japanese|italian|western|cantonese)(?:\s|$)|餐廳|茶餐廳|拉麵|火鍋|燒肉|點心|酒樓|冰室|小食|粉麵|美食|食堂/,
      "Food",
      "Restaurant",
    ],
    [/karaoke|party room|bowling|billiard|board game|escape room|唱k|派對房間/, "Gathering", "Gathering activity"],
    [
      /(?:^|\s)(?:bar|pub|lounge|cocktail|taproom|brewery|wine)(?:\s|$)|酒吧/,
      "Gathering",
      "Drinks & desserts",
    ],
    [/supplements?|vitamins?|保健品|維他命/, "Personal Expense", "Health & supplements"],
    [
      /facial|nail salon|manicure|pedicure|salon|haircut|barber|(?:^|\s)spa(?:\s|$)|massage|lash|brow|美容院|美甲|髮型屋|按摩/,
      "Personal Expense",
      "Beauty treatments",
    ],
    [/cosmetic|skincare|護膚|美妝/, "Personal Expense", "Skincare"],
    [/makeup|make up|化妝品/, "Personal Expense", "Makeup"],
    [
      /(?:^|\s)(?:optical|glasses|eyewear|lens|spectacles|watch|jewellery|jewelry)(?:\s|$)|眼鏡|飾物|首飾|珠寶|鐘錶/,
      "Personal Expense",
      "Accessories",
    ],
    [/pharmaceutical|pharmacy|dispensary|drugstore|clinic|dental|dentist|藥房|藥粧|藥行|診所|牙科/, "Personal Expense", "Daily essentials"],
    [/(?:^|\s)(?:outfit|apparel|boutique|fashion|clothing|shoes|sneakers)(?:\s|$)|服裝|時裝|波鞋/, "Personal Expense", "Leisure clothing"],
    [/electronics|computer|電器|電腦/, "Personal Expense", "Electronics"],
    [/furniture|homeware|hardware|家居|傢俬|家品|五金/, "Personal Expense", "Home"],
    [/cinema|movie|theatre|museum|exhibition|yoga|pilates|戲院|電影|博物館|展覽|瑜伽/, "Personal Expense", "Leisure activities"],
    [/bookstore|bookshop|stationery|書店|書局|文具/, "Personal Expense", "Learning & development"],
    [/florist|flower|gift|hamper|花店|禮物/, "Gift", "Gift"],
    [/airline|airways|flight|航空/, "Travel Expense", "Flights"],
    [/hotel|resort|hostel|酒店/, "Travel Expense", "Accommodation"],
    [/^\s*purchase\s*$/, "Other"],
  ];

  const kwMatch = keywordRules.find(([pattern]) => pattern.test(m));
  if (kwMatch) {
    return withFallbackFlag({ category: kwMatch[1], subcategory: kwMatch[2] }, true);
  }

  return null;
}

export function scoreWebTextForCategory(webText: string): Classification | null {
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
      subcategory: "Dessert",
      keywords: [
        [/\bdessert\b|\bdessert shop\b|\bsweet soup\b|\bshaved ice\b|\bkakigori\b|\bgelato\b|\bice cream\b|\bfrozen yogurt\b|\bfroyo\b|\bwaffle\b|\bcrepe\b|\bsouffle\b|\btiramisu\b|\bpudding\b/g, 5],
        [/甜品|糖水|雪糕|刨冰|豆腐花|芋圓|仙草/g, 5],
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
        [/\bcocktail bar\b|\bwine bar\b|\bcraft beer\b|\bpub\b|\btaproom\b|\bspeakeasy\b/g, 4],
        [/酒吧/g, 4],
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
      if (matches) {
        score += matches.length * weight;
      }
    }
    if (score >= 4 && (!best || score > best.score)) {
      best = { category: b.category, subcategory: b.subcategory, score };
    }
  }

  return best ? withFallbackFlag({ category: best.category, subcategory: best.subcategory }, false) : null;
}

export async function searchAndClassifyMerchant(merchant: string): Promise<Classification | null> {
  const local = classifyMerchant(merchant);
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
- Food: Restaurant | Cafe | Fast food | Food delivery | Bakery | Dessert
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
            return withFallbackFlag(
              {
                category: parsed.category,
                subcategory: typeof parsed.subcategory === "string" ? parsed.subcategory : undefined,
              },
              false,
            );
          }
        }
      }
    } catch {
      // Fall through to keyless web search
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
