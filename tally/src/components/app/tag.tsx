import { cn } from "@/lib/utils";
import { isTagColor } from "@/lib/domain";

/** Notion style tag chip. */
export function Tag({
  color = "gray",
  children,
  className,
  title,
}: {
  color?: string | null;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const c = color && isTagColor(color) ? color : "gray";
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[21px] max-w-full items-center truncate rounded-[4px] px-1.5 text-[12.5px] leading-none whitespace-nowrap",
        className,
      )}
      style={{ background: `var(--tag-${c}-bg)`, color: `var(--tag-${c}-fg)` }}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Dot({ color = "gray", className }: { color?: string | null; className?: string }) {
  const c = color && isTagColor(color) ? color : "gray";
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: `var(--dot-${c})` }}
    />
  );
}
