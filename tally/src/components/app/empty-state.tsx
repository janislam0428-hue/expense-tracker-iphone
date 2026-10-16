import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-6 py-10 sm:items-center sm:text-center",
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground [&_svg]:size-6">{icon}</div> : null}
      <div className="max-w-md">
        <h2 className="text-[15px] font-medium text-foreground">{title}</h2>
        {children ? <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
