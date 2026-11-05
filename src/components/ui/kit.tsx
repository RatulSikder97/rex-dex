"use client";
/**
 * REX UI kit — thin React wrappers over the design-system classes in globals.css.
 * Use these (or the classes directly) instead of ad-hoc button/pill/tab markup:
 *   Page / PageHeader      full-width view with title (20px), description, actions top-right
 *   Pill                   status word (radius 4) — tone: neutral | accent | ok | warn | err
 *   Switch                 on/off setting (role="switch")
 *   Segmented              2–4 mutually exclusive options
 *   Tabs                   underline section tabs (role="tablist")
 *   ErrorState             failed load with a Retry action
 *   LoadingRows            skeleton list while an async view loads (fixed heights: no layout shift)
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, RotateCw } from "lucide-react";

export function Page({ children, className = "", wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className="page">
      <div className={`page-inner ${wide ? "!max-w-none" : ""} ${className}`}>{children}</div>
    </div>
  );
}

export function PageHeader({ title, description, icon: Icon, meta, actions }: { title: ReactNode; description?: ReactNode; icon?: LucideIcon; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      {Icon && (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-line bg-elev text-muted" aria-hidden>
          <Icon size={15} strokeWidth={1.75} />
        </span>
      )}
      <div className="page-head-main">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="page-title truncate">{title}</h1>
          {meta}
        </div>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "err";
export function Pill({ tone = "neutral", icon: Icon, children, title, className = "" }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`pill ${tone === "neutral" ? "" : `pill-${tone}`} ${className}`} title={title}>
      {Icon && <Icon size={11} strokeWidth={2} aria-hidden />}
      {children}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon; title?: string }[]; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title ?? o.label} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon size={13} strokeWidth={1.8} aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
  idPrefix = "tab",
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; icon?: LucideIcon; badge?: ReactNode }[];
  label: string;
  idPrefix?: string;
  className?: string;
}) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.value === value);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : d ? (i + d + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].value);
    document.getElementById(`${idPrefix}-${tabs[to].value}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={`tabs ${className}`} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.value} id={`${idPrefix}-${t.value}`} type="button" role="tab" aria-selected={value === t.value} tabIndex={value === t.value ? 0 : -1} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={13} strokeWidth={1.8} aria-hidden />}
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

/** A load failed: say what, offer Retry. Errors don't apologize. */
export function ErrorState({ title = "Couldn’t load this", error, onRetry, compact }: { title?: string; error?: unknown; onRetry?: () => void; compact?: boolean }) {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    <div role="alert" className={`flex flex-col items-center text-center ${compact ? "gap-1.5 px-4 py-5" : "gap-2 px-6 py-10"}`}>
      <CircleAlert size={compact ? 18 : 24} strokeWidth={1.6} className="text-err" aria-hidden />
      <div className="text-[13px] font-medium">{title}</div>
      {detail && <p className="max-w-[420px] break-words text-[12px] leading-relaxed text-muted">{detail}</p>}
      {onRetry && (
        <button className="btn btn-sm mt-1" onClick={onRetry}>
          <RotateCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

/** Skeleton rows with fixed heights, so the loaded list doesn't shift the layout. */
export function LoadingRows({ rows = 4, height = 24, className = "" }: { rows?: number; height?: number; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${92 - ((i * 17) % 30)}%` }} />
      ))}
    </div>
  );
}
