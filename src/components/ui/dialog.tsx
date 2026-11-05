"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";

/**
 * In-app replacements for window.confirm / window.prompt.
 *
 *   if (!(await confirmDialog({ title: "Delete file?", message: "…", danger: true }))) return;
 *   const name = await promptDialog({ title: "New project", placeholder: "Name" });
 *
 * <DialogHost /> is mounted once in the Workbench. Dialogs queue: one shows at a time.
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
}

type Pending =
  | { id: number; type: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; type: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

let queue: Pending[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => queue[0] ?? null;

function settle(id: number, value: boolean | string | null) {
  const d = queue.find((x) => x.id === id);
  if (!d) return;
  queue = queue.filter((x) => x.id !== id);
  if (d.type === "confirm") d.resolve(value === true);
  else d.resolve(typeof value === "string" ? value : null);
  emit();
}

/** True while an in-app dialog is showing (global shortcuts are suppressed). */
export function isDialogOpen(): boolean {
  return queue.length > 0;
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, type: "confirm", opts, resolve }];
    emit();
  });
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, type: "prompt", opts, resolve }];
    emit();
  });
}

export function DialogHost() {
  const current = useSyncExternalStore(subscribe, snapshot, () => null);
  if (!current) return null;
  return <DialogView key={current.id} d={current} />;
}

function DialogView({ d }: { d: Pending }) {
  const [value, setValue] = useState(d.type === "prompt" ? (d.opts.initial ?? "") : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement | null;
    if (d.type === "prompt") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else okRef.current?.focus();
    return () => restore.current?.focus?.();
  }, [d.type]);

  const cancel = () => settle(d.id, d.type === "confirm" ? false : null);
  const ok = () => {
    if (d.type === "confirm") settle(d.id, true);
    else if (value.trim()) settle(d.id, value.trim());
  };
  const danger = d.type === "confirm" && d.opts.danger;
  const titleId = `dlg-title-${d.id}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 pt-[18vh]"
      onMouseDown={cancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
        // Simple focus trap between the dialog's focusable elements.
        if (e.key === "Tab") {
          const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button, input"));
          const i = els.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : i === els.length - 1 ? 0 : i + 1;
          e.preventDefault();
          els[next]?.focus();
        }
      }}
    >
      <div
        role={d.type === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-[440px] max-w-[92vw] rounded-lg border border-line bg-elev p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {danger && <TriangleAlert size={18} className="mt-0.5 text-warn" aria-hidden />}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[13.5px] font-semibold">
              {d.opts.title}
            </h2>
            {d.opts.message && <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">{d.opts.message}</p>}
          </div>
        </div>
        {d.type === "prompt" && (
          <input
            ref={inputRef}
            className="input mt-3"
            placeholder={d.opts.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ok()}
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={cancel}>
            {(d.type === "confirm" && d.opts.cancelLabel) || "Cancel"}
          </button>
          <button
            ref={okRef}
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            disabled={d.type === "prompt" && !value.trim()}
            onClick={ok}
          >
            {d.opts.confirmLabel ?? (d.type === "confirm" ? "OK" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
