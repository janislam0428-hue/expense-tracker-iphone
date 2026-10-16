// Applies Prisma migrations to Turso (libSQL), then adds reference data.
// Usage: DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... npm run db:deploy
// Each migration runs once; applied names are recorded in _tally_migrations.
import "dotenv/config";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createDbClient } from "../src/lib/db-client";
import { ensureReferenceData } from "../src/lib/reference/ensure";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _tally_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set((await client.execute("SELECT name FROM _tally_migrations")).rows.map((r) => String(r.name)));
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const names = readdirSync(dir).filter((n) => existsSync(path.join(dir, n, "migration.sql"))).sort();
  let count = 0;
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    console.log(`Applying ${name}`);
    await client.executeMultiple(sql);
    await client.execute({ sql: "INSERT INTO _tally_migrations (name, applied_at) VALUES (?, ?)", args: [name, new Date().toISOString()] });
    count++;
  }
  console.log(count ? `Applied ${count} migration(s).` : "Database already up to date.");
  const db = createDbClient();
  await ensureReferenceData(db);
  await db.$disconnect();
  console.log("Reference data ready.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
