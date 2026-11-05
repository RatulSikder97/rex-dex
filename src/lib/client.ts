"use client";
import type { RunEvent } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText, res.status);
  return data as T;
}

/** Subscribes to a run's SSE stream. Returns a close function. */
/** Applies a streamed chunk by its offset: duplicate or replayed chunks don't double the text. */
export function applyChunk(output: string, ev: { text: string; at?: number }): string {
  if (ev.at === undefined) return output + ev.text;
  if (output.length === ev.at) return output + ev.text;
  if (output.length > ev.at) return output.slice(ev.at, ev.at + ev.text.length) === ev.text ? output : output.slice(0, ev.at) + ev.text;
  return output + ev.text;
}

export function streamRun(runId: string, onEvent: (ev: RunEvent) => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data) as RunEvent;
    onEvent(ev);
    if ((ev.type === "status" || ev.type === "snapshot") && ev.status !== "running") es.close();
  };
  es.onerror = () => {
    // Stream ended or server restarted; fetch the final state once.
    es.close();
    fetch(`/api/runs/${runId}`)
      .then((r) => r.json())
      .then((r) => onEvent({ type: "snapshot", output: r.output ?? "", status: r.status ?? "error", error: r.error }))
      .catch(() => onEvent({ type: "status", status: "error", error: "Lost connection to run" }));
  };
  return () => es.close();
}

export function uid(): string {
  return crypto.randomUUID();
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function extractSvg(text: string): string | null {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : null;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function download(filename: string, content: string | Blob, type = "text/plain") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Renders untrusted SVG safely: as an <img> data URL, scripts and handlers never execute. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
