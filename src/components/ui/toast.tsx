"use client";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useWorkbench, type ToastLevel } from "@/store/workbench";
import { useSetting } from "@/store/settings";

export const TOAST_ICON = { info: Info, ok: CircleCheck, error: CircleAlert, warn: TriangleAlert } as const;
export const TOAST_COLOR: Record<ToastLevel, string> = { info: "text-accent", ok: "text-ok", error: "text-err", warn: "text-warn" };

/** Raise a toast from anywhere (outside React too). Errors stay 8 s, others 4 s. */
export function toast(level: ToastLevel, text: string, source?: string) {
  useWorkbench.getState().toast(level, text, source);
}

/** Bottom-right stacked toasts. Mounted once in the Workbench; click a toast to dismiss it. */
export function ToastHost() {
  const toasts = useWorkbench((s) => s.toasts);
  const dismiss = useWorkbench((s) => s.dismissToast);
  // notifications.toasts = false: notifications still land in the status-bar bell.
  const enabled = useSetting<boolean>("notifications.toasts");
  if (!enabled) return null;
  return (
    <div className="pointer-events-none fixed bottom-8 right-3 z-[60] flex w-[360px] max-w-[calc(100vw-24px)] flex-col items-stretch gap-2" aria-live="polite" role="status" aria-label="Notifications">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.level];
        return (
          <div
            key={t.id}
            role={t.level === "error" ? "alert" : undefined}
            onClick={() => dismiss(t.id)}
            title={t.text.length > 160 ? t.text : undefined}
            className="toast-in popover pointer-events-auto flex items-start gap-2.5 !rounded-[6px] py-2 pl-3 pr-1.5"
          >
            <Icon size={15} className={`mt-[2px] shrink-0 ${TOAST_COLOR[t.level]}`} aria-hidden />
            <div className="min-w-0 flex-1 py-px">
              {t.source && <div className="text-[11px] text-faint">{t.source}</div>}
              <div className="line-clamp-4 break-words text-[12.5px] leading-snug">{t.text}</div>
            </div>
            <button
              className="icon-btn !h-5 !w-5"
              aria-label="Dismiss notification"
              title="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
