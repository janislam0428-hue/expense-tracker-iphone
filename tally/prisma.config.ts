import "dotenv/config";
import { defineConfig } from "prisma/config";

// Local development uses a SQLite file. Production uses Turso (libSQL), where
// migrations are applied with `npm run db:deploy` (scripts/db-deploy.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./data/tally.db",
  },
});
