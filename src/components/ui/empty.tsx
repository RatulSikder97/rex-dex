import type { LucideIcon } from "lucide-react";

/** Consistent empty state: icon + one-line hint + optional primary/secondary action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  secondary,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void; icon?: LucideIcon };
  secondary?: { label: string; onClick: () => void };
  compact?: boolean;
}) {
  const A = action?.icon;
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "gap-1.5 px-4 py-5" : "gap-2 px-6 py-10"}`}>
      <Icon size={compact ? 20 : 26} strokeWidth={1.5} className="text-faint" aria-hidden />
      <div className="text-[13px] font-medium">{title}</div>
      {hint && <p className="max-w-[320px] text-[12px] leading-relaxed text-muted">{hint}</p>}
      {(action || secondary) && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-2">
          {action && (
            <button className="btn btn-primary btn-sm" onClick={action.onClick}>
              {A && <A size={13} />} {action.label}
            </button>
          )}
          {secondary && (
            <button className="btn btn-sm" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}
