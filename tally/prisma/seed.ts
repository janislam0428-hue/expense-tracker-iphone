// `npx prisma db seed` (also run by `npm run local`). Creates reference data and,
// when demo data is enabled in Settings, the demo transactions.
import "dotenv/config";
import { createDbClient } from "../src/lib/db-client";
import { ensureReferenceData } from "../src/lib/reference/ensure";
import { loadDemoData } from "../src/lib/demo/apply";

async function main() {
  const db = createDbClient();
  await ensureReferenceData(db);
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const realCount = await db.transaction.count({ where: { isDemo: false } });
  const demoCount = await db.transaction.count({ where: { isDemo: true } });
  if (settings.demoEnabled && demoCount === 0) {
    const r = await loadDemoData(db);
    console.log(`Demo data loaded: ${r.added} transactions, ${r.needsReview} waiting in To confirm.`);
  } else {
    console.log(`Reference data ready. ${realCount} real and ${demoCount} demo transactions present.`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
