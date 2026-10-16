import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

export function cleanEnv(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const cleaned = val.trim().replace(/^["']+|["']+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

// One adapter for both environments:
//   local:      DATABASE_URL="file:./data/tally.db"
//   production: DATABASE_URL="libsql://<db>.turso.io" plus DATABASE_AUTH_TOKEN
export function createDbClient() {
  const url = cleanEnv(process.env.DATABASE_URL) ?? "file:./data/tally.db";
  const authToken = cleanEnv(process.env.DATABASE_AUTH_TOKEN);
  const adapter = new PrismaLibSql({
    url,
    authToken,
  });
  return new PrismaClient({ adapter });
}

export type Db = ReturnType<typeof createDbClient>;
