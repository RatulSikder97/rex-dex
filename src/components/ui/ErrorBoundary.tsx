"use client";
import { useEffect, useState } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { Check, Copy, Download, RotateCw, TriangleAlert } from "lucide-react";

/** Plain-text crash report (message, stack, environment) for Copy / Save report. */
export function crashReport(error: unknown, where: string): string {
  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  const lines = [
    `REX crash report — ${new Date().toISOString()}`,
    `Where: ${where}`,
    typeof location !== "undefined" ? `URL: ${location.href}` : "",
    typeof navigator !== "undefined" ? `Agent: ${navigator.userAgent}` : "",
    "",
    `${e.name}: ${e.message}`,
    e.stack ?? "",
  ];
  return lines.filter((l, i) => l || i === 4).join("\n");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : "Unknown error";
}

function useCopy(): [boolean, (text: string) => void] {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return [
    done,
    (text) => {
      void navigator.clipboard?.writeText(text).then(() => setDone(true), () => setDone(false));
    },
  ];
}

function saveReport(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `rex-crash-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Crash loop escape hatch: drop persisted tabs/pages (the usual culprit), keep project + preferences, reload. */
function resetLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem("rex-workbench") ?? "null") as { state?: Record<string, unknown> } | null;
    if (raw?.state) {
      raw.state.tabs = [];
      raw.state.activeTabId = null;
      localStorage.setItem("rex-workbench", JSON.stringify(raw));
    }
  } catch {
    try {
      localStorage.removeItem("rex-workbench");
    } catch {
      /* storage unavailable: reload anyway */
    }
  }
  location.reload();
}

/** Full-window recoverable crash screen (top-level boundary, app/error.tsx, app/global-error.tsx). */
export function CrashScreen({ error, onRetry, where = "workbench" }: { error: unknown; onRetry?: () => void; where?: string }) {
  const [copied, copy] = useCopy();
  const report = crashReport(error, where);
  useEffect(() => {
    console.error("[REX] crashed:", error);
  }, [error]);
  return (
    <div className="fixed inset-0 grid place-items-center overflow-auto bg-bg p-6 text-fg" role="alert" aria-live="assertive">
      <div className="w-full max-w-[520px]">
        <div className="flex items-start gap-3">
          <TriangleAlert size={20} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold">REX ran into a problem</h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Your projects, tasks and files are stored on this Mac and weren’t affected. Reload to continue where you left off.
            </p>
          </div>
        </div>
        <pre className="mt-4 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-line bg-side px-3 py-2 font-mono text-[11.5px] leading-relaxed text-muted">{errorMessage(error)}</pre>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => location.reload()} autoFocus>
            <RotateCw size={13} /> Reload REX
          </button>
          {onRetry && (
            <button className="btn" onClick={onRetry}>
              Try again
            </button>
          )}
          <button className="btn btn-ghost" onClick={resetLayout} title="Close all open tabs and pages, then reload. Projects and tasks are kept.">
            Reset layout
          </button>
          <span className="flex-1" />
          <button className="btn btn-ghost" onClick={() => copy(report)}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy error"}
          </button>
          <button className="btn btn-ghost" onClick={() => saveReport(report)} title="Save a crash report file to attach to a support request">
            <Download size={13} /> Save report
          </button>
        </div>
      </div>
    </div>
  );
}

/** In-place fallback for one view (page, tab, panel): the rest of the workbench keeps working. */
export function ViewCrash({ error, onRetry, label }: { error: unknown; onRetry: () => void; label: string }) {
  const [copied, copy] = useCopy();
  useEffect(() => {
    console.error(`[REX] ${label} crashed:`, error);
  }, [error, label]);
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center p-6" role="alert">
      <div className="w-full max-w-[440px] text-center">
        <TriangleAlert size={22} strokeWidth={1.6} className="mx-auto text-warn" aria-hidden />
        <div className="mt-2 text-[13px] font-medium">{label} stopped working</div>
        <p className="mt-1 break-words text-[12px] leading-relaxed text-muted">{errorMessage(error)}</p>
        <div className="mt-3 flex justify-center gap-2">
          <button className="btn btn-sm btn-primary" onClick={onRetry}>
            <RotateCw size={12} /> Reload view
          </button>
          <button className="btn btn-sm" onClick={() => copy(crashReport(error, label))}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy error"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Top-level boundary around the whole workbench. */
export const AppErrorBoundary = catchError(function AppFallback(_props: object, { error, reset }: ErrorInfo) {
  return <CrashScreen error={error} onRetry={reset} />;
});

/** Scoped boundary for a single view; `label` names it in the fallback ("Settings stopped working"). */
export const ViewErrorBoundary = catchError(function ViewFallback({ label }: { label: string }, { error, reset }: ErrorInfo) {
  return <ViewCrash error={error} onRetry={reset} label={label} />;
});
