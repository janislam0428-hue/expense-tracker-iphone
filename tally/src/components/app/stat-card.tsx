import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "attention";
  href?: string;
}) {
  const body = (
    <>
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div className="tabular mt-1.5 line-clamp-2 text-[22px] leading-tight font-semibold tracking-tight break-words text-foreground">{value}</div>
      {hint ? <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{hint}</div> : null}
    </>
  );
  const cls = cn(
    "block min-w-0 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors",
    href && "hover:bg-hover",
    tone === "attention" && "border-[color-mix(in_srgb,var(--dot-red)_35%,transparent)]",
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
