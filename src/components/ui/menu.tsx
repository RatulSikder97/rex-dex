"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";

export type MenuAction = { type?: "item"; label: string; icon?: LucideIcon; /** Rendered before the label (e.g. a project avatar). */ lead?: React.ReactNode; hint?: string; disabled?: boolean; checked?: boolean; danger?: boolean; onSelect: () => void };
export type MenuSubmenu = { type: "submenu"; label: string; icon?: LucideIcon; disabled?: boolean; items: MenuItem[] };
export type MenuItem = MenuAction | MenuSubmenu | { type: "separator" } | { type: "header"; label: string };

/** Current CSS zoom applied to <html> (workbench.zoomLevel); positions from events/rects are divided by it. */
export function uiZoom(): number {
  if (typeof document === "undefined") return 1;
  const z = parseFloat(document.documentElement.style.zoom || "1");
  return Number.isFinite(z) && z > 0 ? z : 1;
}

const isEnabled = (it: MenuItem) => (it.type === undefined || it.type === "item" || it.type === "submenu") && !(it as { disabled?: boolean }).disabled;

interface MenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  minWidth?: number;
  label?: string;
  /** Menu bar integration: ←/→ at the root level (→ only when the active item has no submenu). */
  onNavigate?: (dir: 1 | -1) => void;
  /** Mousedown targets that should not close the menu (e.g. the menu bar buttons). */
  ignoreOutside?: (target: Element) => boolean;
  /** Highlight the first item on open (keyboard-opened); otherwise nothing is highlighted until hover. */
  autoActivate?: boolean;
}

/**
 * Floating menu anchored at a viewport point (context menus, dropdowns, menu bar).
 * Keyboard: ↑/↓/Home/End move, Enter/Space select, → opens a submenu, ← / Esc close it, Esc closes.
 */
export function Menu(props: MenuProps) {
  const tree = useId();
  const { onClose, ignoreOutside } = props;
  const rootClose = useRef(onClose);
  rootClose.current = onClose;
  // Whatever had focus when the menu opened (usually its trigger) gets it back when the menu closes.
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);

  useEffect(
    () => () => {
      const el = opener.current as HTMLElement | null;
      const a = document.activeElement;
      // Only when focus would otherwise be lost (still inside the closed menu, or on <body>).
      const lost = !a || a === document.body || !a.isConnected || !!a.closest?.(`[data-menu-tree="${CSS.escape(tree)}"]`);
      if (lost && el?.isConnected && typeof el.focus === "function") el.focus({ preventScroll: true });
    },
    [tree],
  );

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(`[data-menu-tree="${CSS.escape(tree)}"]`)) return;
      if (t && ignoreOutside?.(t)) return;
      rootClose.current();
    };
    const blur = () => rootClose.current();
    window.addEventListener("mousedown", down, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [tree, ignoreOutside]);

  return <MenuPanel {...props} tree={tree} autoActivate={props.autoActivate ?? true} />;
}

function MenuPanel({
  x,
  y,
  items,
  onClose,
  minWidth = 200,
  label,
  onNavigate,
  tree,
  autoActivate,
  anchor,
  onBack,
}: MenuProps & { tree: string; anchor?: DOMRect; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x / uiZoom(), top: y / uiZoom() });
  const selectable = items.map((it, i) => (isEnabled(it) ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState(autoActivate ? (selectable[0] ?? -1) : -1);
  const [sub, setSub] = useState<{ index: number; rect: DOMRect; focus: boolean } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the menu inside the viewport (submenus flip to the left of their parent when needed).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const z = uiZoom();
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (anchor) {
      left = anchor.right - 2;
      top = anchor.top - 5;
      if (left + r.width > vw - 4) left = Math.max(4, anchor.left - r.width + 2);
    }
    left = Math.max(4, Math.min(left, vw - r.width - 4));
    top = Math.max(4, Math.min(top, vh - r.height - 4));
    setPos({ left: left / z, top: top / z });
  }, [x, y, anchor]);

  useEffect(() => {
    // Hover-opened submenus leave focus on their parent until the pointer enters them.
    if (!anchor || autoActivate) ref.current?.focus({ preventScroll: true });
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  const rowRect = (i: number) => ref.current?.querySelector<HTMLElement>(`[data-menu-index="${i}"]`)?.getBoundingClientRect();

  const openSub = (i: number, focus: boolean) => {
    const it = items[i];
    if (!it || it.type !== "submenu" || it.disabled) return;
    const rect = rowRect(i);
    if (rect) setSub({ index: i, rect, focus });
  };

  const select = (i: number) => {
    const it = items[i];
    if (!it || !isEnabled(it)) return;
    if (it.type === "submenu") return openSub(i, true);
    if (it.type === "separator" || it.type === "header") return;
    onClose();
    it.onSelect();
  };

  const move = (dir: 1 | -1) => {
    if (!selectable.length) return;
    const at = selectable.indexOf(active);
    setActive(selectable[at < 0 ? (dir === 1 ? 0 : selectable.length - 1) : (at + dir + selectable.length) % selectable.length]);
  };

  const subItem = sub ? items[sub.index] : null;

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        data-menu-tree={tree}
        className="popover fixed z-[65] py-1 text-[12.5px] text-fg"
        style={{ left: pos.left, top: pos.top, minWidth, outline: "none" }}
        onContextMenu={(e) => e.preventDefault()}
        onMouseEnter={() => anchor && document.activeElement !== ref.current && ref.current?.focus({ preventScroll: true })}
        onKeyDown={(e) => {
          e.stopPropagation();
          const it = items[active];
          if (e.key === "Escape") {
            e.preventDefault();
            if (onBack) onBack();
            else onClose();
          } else if (e.key === "ArrowDown") (e.preventDefault(), move(1));
          else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
          else if (e.key === "Home") (e.preventDefault(), setActive(selectable[0] ?? -1));
          else if (e.key === "End") (e.preventDefault(), setActive(selectable[selectable.length - 1] ?? -1));
          else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (it?.type === "submenu" && !it.disabled) openSub(active, true);
            else onNavigate?.(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (onBack) onBack();
            else onNavigate?.(-1);
          } else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), select(active));
          else if (e.key === "Tab") (e.preventDefault(), onClose());
          else if (e.key.length === 1 && /\S/.test(e.key)) {
            // Type-to-jump to the next item starting with that letter.
            const ch = e.key.toLowerCase();
            const order = [...selectable.filter((i) => i > active), ...selectable.filter((i) => i <= active)];
            const hit = order.find((i) => (items[i] as { label?: string }).label?.toLowerCase().startsWith(ch));
            if (hit !== undefined) setActive(hit);
          }
        }}
      >
        {items.map((it, i) => {
          if (it.type === "separator") return <div key={i} role="separator" className="mx-2 my-1 h-px bg-line" />;
          if (it.type === "header")
            return (
              <div key={i} className="section-title flex h-[24px] items-center px-3 !text-faint" role="presentation">
                {it.label}
              </div>
            );
          const Icon = it.icon;
          const isSub = it.type === "submenu";
          const checked = !isSub ? (it as MenuAction).checked : undefined;
          const highlighted = (active === i || sub?.index === i) && !it.disabled;
          return (
            <div
              key={i}
              data-menu-index={i}
              role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={checked}
              aria-disabled={it.disabled || undefined}
              aria-haspopup={isSub ? "menu" : undefined}
              aria-expanded={isSub ? sub?.index === i : undefined}
              onMouseEnter={() => {
                if (it.disabled) return;
                setActive(i);
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                hoverTimer.current = setTimeout(() => {
                  if (isSub) openSub(i, false);
                  else setSub(null);
                }, isSub ? 120 : 220);
              }}
              onClick={() => select(i)}
              className={`mx-1 flex h-[24px] items-center gap-2 rounded-[4px] pl-1.5 pr-2 ${it.disabled ? "text-faint" : ""} ${highlighted ? "bg-active" : ""} ${
                !isSub && (it as MenuAction).danger && !it.disabled ? "text-err" : ""
              }`}
            >
              <span className={`flex w-4 shrink-0 justify-center ${checked ? "text-accent" : "text-muted"}`} aria-hidden>
                {checked ? <Check size={13} strokeWidth={2.2} /> : Icon ? <Icon size={13} /> : null}
              </span>
              {!isSub && (it as MenuAction).lead}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {!isSub && (it as MenuAction).hint && <span className="ml-6 shrink-0 text-right text-[11.5px] tabular-nums text-faint">{(it as MenuAction).hint}</span>}
              {isSub && <ChevronRight size={13} className="ml-4 shrink-0 text-faint" aria-hidden />}
            </div>
          );
        })}
      </div>
      {sub && subItem?.type === "submenu" && (
        <MenuPanel
          key={sub.index}
          x={0}
          y={0}
          anchor={sub.rect}
          items={subItem.items}
          label={subItem.label}
          tree={tree}
          minWidth={180}
          autoActivate={sub.focus}
          onClose={onClose}
          onBack={() => {
            setSub(null);
            setActive(sub.index);
            ref.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}
