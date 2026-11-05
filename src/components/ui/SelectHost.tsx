"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { uiZoom } from "./menu";

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
  group: string | null;
}

interface Open {
  el: HTMLSelectElement;
  options: Opt[];
  value: string;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

/** Sets a React-controlled <select>'s value the way user input would (fires onChange). */
function commit(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Replaces the browser's native <select> popup app-wide with a REX menu.
 *
 * Native popups ignore CSS `zoom` (REX's UI zoom), so they open in the wrong
 * place, and they look out of place. Every <select> keeps working as a normal
 * form control (keyboard, onChange); only the mouse-opened popup is ours.
 * Opt out per element with data-native-select.
 */
export default function SelectHost() {
  const [open, setOpen] = useState<Open | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = true) => {
    setOpen((o) => {
      if (o && refocus) o.el.focus();
      return null;
    });
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLSelectElement) || el.disabled || el.multiple || el.size > 1 || el.hasAttribute("data-native-select") || e.button !== 0) return;
      e.preventDefault();
      el.focus();
      const z = uiZoom();
      const r = el.getBoundingClientRect();
      const options: Opt[] = Array.from(el.options).map((o) => ({
        value: o.value,
        label: o.label || o.text,
        disabled: o.disabled,
        group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : null,
      }));
      // Viewport and rect are in visual px; the portal is laid out in zoomed CSS px.
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const above = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(360, Math.max(120, above ? spaceAbove : spaceBelow));
      setOpen({
        el,
        options,
        value: el.value,
        left: r.left / z,
        top: (above ? r.top - 4 : r.bottom + 4) / z,
        width: Math.max(r.width / z, 160),
        maxHeight: maxHeight / z,
        above,
      });
      setActive(Math.max(0, options.findIndex((o) => o.value === el.value)));
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !list.current?.contains(e.target as Node) && e.target !== open.el && close(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => {
          let n = i;
          for (let k = 0; k < open.options.length; k++) {
            n = (n + dir + open.options.length) % open.options.length;
            if (!open.options[n].disabled) break;
          }
          return n;
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const o = open.options[active];
        if (o && !o.disabled) {
          commit(open.el, o.value);
          close();
        }
      }
    };
    const onScroll = (e: Event) => !list.current?.contains(e.target as Node) && close(false);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    const onResize = () => close(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, active, close]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;
  let lastGroup: string | null = null;
  return createPortal(
    <div
      ref={list}
      role="listbox"
      className="fixed z-[200] overflow-y-auto rounded-lg border border-line bg-elev p-1 text-fg shadow-[0_12px_32px_rgba(0,0,0,.45)]"
      style={{ left: open.left, top: open.above ? undefined : open.top, bottom: open.above ? `calc(100% - ${open.top}px)` : undefined, minWidth: open.width, maxWidth: 420, maxHeight: open.maxHeight }}
    >
      {open.options.map((o, i) => {
        const header = o.group && o.group !== lastGroup ? o.group : null;
        lastGroup = o.group;
        return (
          <div key={`${i}:${o.value}`}>
            {header && <div className="px-2.5 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{header}</div>}
            <button
              type="button"
              role="option"
              data-idx={i}
              aria-selected={o.value === open.value}
              disabled={o.disabled}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                commit(open.el, o.value);
                close();
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] disabled:cursor-not-allowed disabled:opacity-40 ${i === active ? "bg-hover" : ""}`}
            >
              <span className="w-3.5 shrink-0">{o.value === open.value && <Check size={13} className="text-accent" />}</span>
              <span className="truncate">{o.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
