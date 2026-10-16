import "server-only";
import { createDbClient, type Db } from "@/lib/db-client";

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db: Db = globalForPrisma.prisma ?? createDbClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
