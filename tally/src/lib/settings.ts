import "server-only";
import { db } from "@/lib/db";
import { ensureDatabaseInitialized } from "@/lib/db-init";

export async function getSettings() {
  await ensureDatabaseInitialized();
  return db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export type AppSettings = Awaited<ReturnType<typeof getSettings>>;

/** Where clause fragment that hides demo rows once demo data is switched off. */
export function demoScope(settings: Pick<AppSettings, "demoEnabled">) {
  return settings.demoEnabled ? {} : { isDemo: false };
}
