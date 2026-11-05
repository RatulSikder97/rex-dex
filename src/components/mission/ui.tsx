import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { DeptIcon } from "@/components/icons";

/**
 * Mission-mode section: a small uppercase label (+ count, optional action) over its content.
 * `hint` is kept for callers but only used as the accessible description, never as a visible subtitle.
 */
export function Section({ title, hint, count, action, children, className = "" }: { title: string; hint?: string; count?: number; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} title={hint} className={className}>
      <header className="mb-2 flex h-6 items-center gap-2">
        <h3 className="rx-label">{title}</h3>
        {!!count && <span className="count">{count}</span>}
        <span className="flex-1" />
        {action}
      </header>
      {children}
    </section>
  );
}

/** Quiet text button for section headers ("Board", "All swarms"…). */
export function SectionAction({ icon: Icon, children, onClick, title }: { icon?: LucideIcon; children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button className="flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={onClick} title={title}>
      {Icon && <Icon size={12} />} {children}
    </button>
  );
}

/** Small pill badge for Workspace tabs. */
export function TabBadge({ n, tone = "accent" }: { n: number; tone?: "accent" | "err" | "ok" }) {
  if (!n) return null;
  const color = tone === "err" ? "var(--err)" : tone === "ok" ? "var(--ok)" : "var(--accent)";
  return (
    <span className="count" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color: `color-mix(in srgb, ${color} 80%, var(--fg))` }}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Department avatar: rounded square tinted with the department color. */
export function DeptAvatar({ dept, size = 28, ring, className = "" }: { dept: { icon: string; color: string }; size?: number; ring?: boolean; className?: string }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    // Nudged toward the foreground so pale department colors stay legible on light themes.
    color: `color-mix(in srgb, ${dept.color} 68%, var(--fg))`,
    background: `color-mix(in srgb, ${dept.color} 16%, transparent)`,
    boxShadow: ring ? `0 0 0 2px var(--bg-editor), 0 0 0 3.5px ${dept.color}` : `inset 0 0 0 1px color-mix(in srgb, ${dept.color} 28%, transparent)`,
  };
  return (
    <span className={`grid shrink-0 place-items-center rounded-[6px] ${className}`} style={style} aria-hidden>
      <DeptIcon name={dept.icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Status dot; `live` adds a soft ping ring. */
export function StatusDot({ color, live, className = "" }: { color: string; live?: boolean; className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${live ? "rx-live" : ""} ${className}`} style={{ background: color, color }} aria-hidden />;
}

/** Calm empty state for a block inside a Mission tab. */
export function BlockEmpty({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[6px] border border-dashed border-line px-4 py-5 text-center">
      <Icon size={18} strokeWidth={1.6} className="text-faint" aria-hidden />
      <div className="text-[13px] font-medium">{title}</div>
      {hint && <p className="max-w-[300px] text-[12px] leading-relaxed text-muted">{hint}</p>}
      {action}
    </div>
  );
}

/** Full-panel empty state with an icon tile — used by the Workspace tabs. */
export function PanelEmpty({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="rx-fade flex min-h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <Icon size={28} strokeWidth={1.4} className="text-faint" aria-hidden />
      <div className="text-[15px] font-semibold">{title}</div>
      {hint && <p className="max-w-[320px] text-[12.5px] leading-relaxed text-muted">{hint}</p>}
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
