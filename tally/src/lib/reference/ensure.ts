import type { Db } from "@/lib/db-client";
import { CATEGORY_SEEDS, PURPOSE_SEEDS, SOURCE_SEEDS } from "./catalog";

/** Creates settings, categories, purposes and sources if they are missing. Safe to run repeatedly. */
export async function ensureReferenceData(db: Db) {
  await db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  let order = 0;
  for (const seed of CATEGORY_SEEDS) {
    order += 10;
    let parent = await db.category.findFirst({ where: { name: seed.name, parentId: null } });
    if (!parent) {
      parent = await db.category.create({
        data: { name: seed.name, color: seed.color, ambiguous: seed.ambiguous, sortOrder: order },
      });
    }
    let childOrder = 0;
    for (const child of seed.children ?? []) {
      childOrder += 1;
      const exists = await db.category.findFirst({ where: { name: child, parentId: parent.id } });
      if (!exists) {
        await db.category.create({
          data: {
            name: child,
            parentId: parent.id,
            color: seed.color,
            ambiguous: seed.ambiguous,
            sortOrder: childOrder,
          },
        });
      }
    }
  }

  let pOrder = 0;
  for (const p of PURPOSE_SEEDS) {
    pOrder += 1;
    await db.purpose.upsert({
      where: { name: p.name },
      update: {},
      create: { name: p.name, color: p.color, shortcutKey: p.shortcutKey, sortOrder: pOrder, isSystem: true },
    });
  }

  for (const s of SOURCE_SEEDS) {
    await db.paymentSource.upsert({
      where: { name: s.name },
      update: {},
      create: { name: s.name, kind: s.kind, color: s.color },
    });
  }
}

export type RefMaps = {
  category: (name: string, child?: string) => { id: string; ambiguous: boolean };
  purpose: (name: string) => string;
  source: (name: string) => string;
};

/** Name based lookups for generators and importers. Throws on unknown names so typos fail loudly. */
export async function loadRefMaps(db: Db): Promise<RefMaps> {
  const [cats, purposes, sources] = await Promise.all([
    db.category.findMany(),
    db.purpose.findMany(),
    db.paymentSource.findMany(),
  ]);
  const parentByName = new Map(cats.filter((c) => !c.parentId).map((c) => [c.name, c]));
  const childByKey = new Map(
    cats.filter((c) => c.parentId).map((c) => [`${c.parentId}::${c.name}`, c]),
  );
  return {
    category(name, child) {
      const parent = parentByName.get(name);
      if (!parent) throw new Error(`Unknown category ${name}`);
      if (!child) return { id: parent.id, ambiguous: parent.ambiguous };
      const c = childByKey.get(`${parent.id}::${child}`);
      if (!c) throw new Error(`Unknown subcategory ${name} / ${child}`);
      return { id: c.id, ambiguous: parent.ambiguous };
    },
    purpose(name) {
      const p = purposes.find((x) => x.name === name);
      if (!p) throw new Error(`Unknown purpose ${name}`);
      return p.id;
    },
    source(name) {
      const s = sources.find((x) => x.name === name);
      if (!s) throw new Error(`Unknown source ${name}`);
      return s.id;
    },
  };
}
