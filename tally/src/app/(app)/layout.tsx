import { Suspense } from "react";
import { requireAuth } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { demoScope, getSettings } from "@/lib/settings";
import { MobileBar, Sidebar } from "@/components/app/sidebar";
import { ShellSkeleton, PageSkeleton } from "@/components/app/skeletons";

async function AuthedShell({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const settings = await getSettings();
  const pendingCount = await db.transaction.count({
    where: { ...demoScope(settings), purposeStatus: "needs_review", duplicateOfId: null },
  });
  const shell = { pendingCount, demoEnabled: settings.demoEnabled };
  return (
    <div className="flex min-h-dvh">
      <Sidebar {...shell} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar {...shell} />
        <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-6 pb-16 sm:px-8 md:pt-10 lg:px-12">
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}
