/** Skeleton block — bentuk nyaris sama kayak konten final, bukan spinner generik. */
export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden="true" />;
}
