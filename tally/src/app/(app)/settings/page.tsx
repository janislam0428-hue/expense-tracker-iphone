import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "./settings-form";
import { DemoToggle } from "./demo-toggle";
import { PasswordForm } from "./password-form";
import { ApiTokenCard } from "./api-token-card";

export const metadata: Metadata = { title: "Settings" };

const NON_SPEND = new Set(["Money Received", "Top ups & Transfers"]);
const plain = (minor: number) => String(minor / 100);

export default async function SettingsPage() {
  await requireAuth();
  const settings = await getSettings();
  const [categories, realCount] = await Promise.all([
    db.category.findMany({ where: { parentId: null, archived: false }, orderBy: { sortOrder: "asc" } }),
    db.transaction.count({ where: { isDemo: false } }),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Settings" />
      <SettingsForm
        currency={settings.currency}
        timezone={settings.timezone}
        weekStart={settings.weekStart}
        reviewThreshold={plain(settings.reviewThresholdMinor)}
        alertThreshold={plain(settings.alertThresholdMinor)}
        categories={categories
          .filter((c) => !NON_SPEND.has(c.name))
          .map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            override: c.monthlyAlertMinor === null ? "" : plain(c.monthlyAlertMinor),
          }))}
      />

      <section id="webhook" aria-labelledby="webhook-h" className="flex scroll-mt-8 flex-col gap-5">
        <h2 id="webhook-h" className="border-b border-border pb-2 text-[15px] font-medium">
          iPhone 14 Pro & Shortcuts API
        </h2>
        <ApiTokenCard hasExistingToken={!!settings.apiTokenHash} />
      </section>

      <section id="demo" aria-labelledby="demo-h" className="flex scroll-mt-8 flex-col gap-5">
        <h2 id="demo-h" className="border-b border-border pb-2 text-[15px] font-medium">
          Demo data
        </h2>
        <DemoToggle enabled={settings.demoEnabled} realCount={realCount} />
      </section>

      <section aria-labelledby="security" className="flex flex-col gap-5">
        <h2 id="security" className="border-b border-border pb-2 text-[15px] font-medium">
          Password
        </h2>
        <PasswordForm />
      </section>
    </div>
  );
}
