import { CircleCheck, CircleDashed, CircleDot } from "lucide-react";

export function PurposeStatusIcon({ status }: { status: string }) {
  if (status === "needs_review")
    return (
      <span className="inline-flex shrink-0 items-center text-[var(--dot-red)]" title="Waiting for you to confirm the purpose">
        <CircleDot className="size-3.5" aria-label="To confirm" />
      </span>
    );
  if (status === "confirmed")
    return (
      <span className="inline-flex shrink-0 items-center text-success" title="Confirmed by you">
        <CircleCheck className="size-3.5" aria-label="Confirmed" />
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center text-faint" title="Filled in automatically">
      <CircleDashed className="size-3.5" aria-label="Automatic" />
    </span>
  );
}
