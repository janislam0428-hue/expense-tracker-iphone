import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-lg" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-[240px] shrink-0 border-r border-sidebar-border bg-sidebar md:block" />
      <div className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-6 sm:px-8 md:pt-10 lg:px-12">
        <PageSkeleton />
      </div>
    </div>
  );
}
