# Tally

A private, Notion style spending tracker for iPhone 14 Pro users in Hong Kong. Most spending goes through Octopus, PayMe, and credit cards, so Tally is built around automated, zero-credit capture: **iPhone 14 Pro notification pop-outs**, **Apple Wallet transaction automations**, and quick **Back Tap capture**.

It removes duplicates, categorises everything locally without external LLM credit costs, asks about purpose only when it isn't obvious, and presents clean Notion-style analytics, category alerts, and forecasts.

## 📱 iPhone 14 Pro Zero-Credit Ingestion

Traditional trackers query expensive cloud AI APIs for every transaction. Tally eliminates AI credit costs:
1. **On-Device Vision OCR**: iPhone Shortcuts uses Apple's native Vision framework (`Extract Text from Image`) locally on your phone (0 API credits).
2. **Local Pattern Parser**: Tally's `/api/ingest` endpoint extracts amounts, merchants, cards, and balances using tuned regex rules in <1ms (0 API credits).
3. **Smart Rule Engine**: Recurring merchants are auto-categorised via `MerchantRule` without human intervention or AI re-inference.

👉 **Complete Setup Instructions**: See [`docs/IPHONE_SHORTCUT_GUIDE.md`](docs/IPHONE_SHORTCUT_GUIDE.md).

## Run it locally

You need Node.js 20.19 or newer.

```bash
npm install
npm run local
```

Open http://localhost:3000 and sign in with the local default password `tally`. Change it in Settings.

`npm run local` creates `.env` with a random session secret, prepares the SQLite database in `data/`, adds categories, purposes and payment sources, loads the demo data, and starts the app.

## Build status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Project setup, data model, login, demo data | Done |
| 2 | Transactions table, manual add, search & filters | Done |
| 3 | Zero-credit notification parser, text import, duplicate detection, webhook | Done |
| 4 | Categorisation rules and interactive To confirm inbox | Done |
| 5 | Dashboard filters, highlights and category alerts | Done |
| 6 | Seasonality, forecasts and insights tiering | Done |
| 7 | iPhone 14 Pro Shortcuts guide, API token management, polish | Done |

## Key Features & Endpoints

- **`/api/ingest`**: Webhook endpoint for iPhone 14 Pro Shortcuts. Accepts notification text via `POST`, parses transaction amounts, checks for duplicates, applies category rules, and returns a confirmation message.
- **`/import`**: Web-based paste testing tool for notification records and iPhone Shortcut credentials.
- **`/transactions`**: Notion-style database view with live search, category/source filtering, manual transaction creation, and deletion.
- **`/review`**: "To confirm" inbox for ambiguous transactions or amounts exceeding the review threshold (HK$500 default) with one-tap purpose buttons (`Personal`, `Work`, `Gift`, etc.) and rule memory.
- **`/settings`**: Webhook API token generation and management, currency & timezone controls, per-category alert thresholds, and demo data toggle.

## Project layout

```
prisma/schema.prisma         Data model (Transaction, Category, Purpose, PaymentSource, etc.)
prisma/seed.ts               Reference data and demo data
scripts/local.mjs            One-command local start
src/proxy.ts                 Session gate (exempts /api/ingest for shortcuts)
src/lib/parsers/             Zero-credit notification parser & ingestion engine
src/lib/auth/                Password hashing, signed session cookie, rate limit
src/lib/review/rules.ts      Review threshold rules (> HK$500, ambiguous category, P2P)
src/lib/alerts/strategy.ts   Monthly category alerts (fixed & adaptive)
src/app/api/ingest/route.ts  iPhone 14 Pro Webhook endpoint
src/app/(app)/import/        Paste test tool & shortcut setup
src/app/(app)/transactions/  Transaction list, search, filters & add modal
src/app/(app)/review/        Interactive To confirm inbox
src/app/(app)/settings/      Settings, password & webhook token generator
docs/                        iPhone 14 Pro Shortcuts setup guide
```
