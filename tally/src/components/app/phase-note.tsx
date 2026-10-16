import { Clock3 } from "lucide-react";

/** Small, honest marker for features scheduled in a later build phase. */
export function PhaseNote({ phase, children }: { phase: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
      <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        <span className="font-medium text-foreground">Coming in Phase {phase}.</span> {children}
      </p>
    </div>
  );
}
