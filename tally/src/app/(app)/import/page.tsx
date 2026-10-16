import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { getSettings } from "@/lib/settings";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  await requireAuth();
  const settings = await getSettings();

  // If no apiTokenHash is stored, we display the fallback token
  const token = settings.apiTokenHash ? "configured (see Settings)" : "tally_secret_token";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import"
        description="Capture spending effortlessly from your iPhone 14 Pro notifications, Wallet automations, or copied records."
      />
      <ImportClient apiToken={token} />
    </div>
  );
}
