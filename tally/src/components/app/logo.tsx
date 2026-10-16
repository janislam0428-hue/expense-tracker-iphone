// Tally mark: four strokes and a diagonal, the oldest way to count.
export function Logo({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="Tally"
      className={className}
    >
      <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
      <g stroke="var(--background)" strokeWidth="1.9" strokeLinecap="round">
        <path d="M7.5 7v10M10.5 7v10M13.5 7v10M16.5 7v10" />
        <path d="M5.5 15.5 18.5 8.5" />
      </g>
    </svg>
  );
}
