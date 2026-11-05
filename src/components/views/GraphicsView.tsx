"use client";
import { useEffect, useRef, useState } from "react";
import { Code, Download, ImageIcon, Save, Sparkles, Square, Wand2 } from "lucide-react";
import { api, download, extractSvg, streamRun, svgDataUrl, applyChunk } from "@/lib/client";
import type { ProviderId, Run } from "@/lib/types";
import AgentPicker from "@/components/AgentPicker";
import { useActiveProject, useWorkbench } from "@/store/workbench";

const PRESETS = [
  { id: "og", label: "OG / link preview", w: 1200, h: 630 },
  { id: "ig", label: "Instagram post", w: 1080, h: 1080 },
  { id: "story", label: "Story / Reel cover", w: 1080, h: 1920 },
  { id: "yt", label: "YouTube thumbnail", w: 1280, h: 720 },
  { id: "x", label: "X header", w: 1500, h: 500 },
  { id: "li", label: "LinkedIn post", w: 1200, h: 1200 },
  { id: "logo", label: "Logo / icon", w: 512, h: 512 },
  { id: "ad", label: "Display ad", w: 300, h: 250 },
];

export default function GraphicsView() {
  const project = useActiveProject();
  const { log, bump, openTab } = useWorkbench();
  const [preset, setPreset] = useState(PRESETS[0]);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderId | "">("");
  const [svg, setSvg] = useState<string>("");
  const [raw, setRaw] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const closeRef = useRef<() => void>(() => {});

  useEffect(() => () => closeRef.current(), []);

  const generate = async (refine: boolean) => {
    if (!prompt.trim()) return;
    const brief = refine && svg
      ? `Revise the current graphic: ${prompt}\nKeep the exact canvas size ${preset.w}x${preset.h} (viewBox="0 0 ${preset.w} ${preset.h}"). Return the full updated SVG.`
      : `Design a ${preset.label} graphic at exactly ${preset.w}x${preset.h} (viewBox="0 0 ${preset.w} ${preset.h}", width="${preset.w}" height="${preset.h}").\n\nBrief: ${prompt}`;
    try {
      const run = await api<Run>("/api/runs", {
        method: "POST",
        json: { department: "design", provider: provider || null, brief, projectId: project?.id ?? null, context: refine && svg ? `Current SVG:\n${svg}` : undefined },
      });
      setRunId(run.id);
      setRaw("");
      let acc = "";
      closeRef.current = streamRun(run.id, (ev) => {
        if (ev.type === "chunk") acc = applyChunk(acc, ev);
        if (ev.type === "snapshot") acc = ev.output;
        setRaw(acc);
        const found = extractSvg(acc);
        if (found) setSvg(found);
        if ((ev.type === "status" || ev.type === "snapshot") && ev.status !== "running") {
          setRunId(null);
          if (ev.status === "error") log("error", "graphics", ev.error ?? "Generation failed");
          else if (!extractSvg(acc)) log("error", "graphics", "The model did not return an SVG");
          else log("ok", "graphics", "Graphic ready");
        }
      });
    } catch (e) {
      log("error", "graphics", String(e));
    }
  };

  const exportPng = async (scale = 1) => {
    if (!svg) return;
    const img = new Image();
    img.src = svgDataUrl(svg);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = preset.w * scale;
    canvas.height = preset.h * scale;
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => b && download(`${preset.id}-${preset.w}x${preset.h}${scale > 1 ? `@${scale}x` : ""}.png`, b), "image/png");
  };

  const save = async () => {
    const d = await api<{ id: string; title: string }>("/api/deliverables", {
      method: "POST",
      json: { project_id: project?.id ?? null, department: "design", kind: "svg", title: `${preset.label}: ${prompt.slice(0, 60)}`, content: svg },
    });
    bump();
    openTab({ kind: "deliverable", id: d.id }, d.title);
  };

  const stop = () => api(`/api/runs/${runId}/cancel`, { method: "POST" }).catch((e) => log("error", "graphics", String(e)));

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-editor">
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2">
        <h1 className="page-title shrink-0">Graphics studio</h1>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {svg && (
            <>
              <div className="flex items-center" role="group" aria-label="Export">
                <button className="btn rounded-r-none" onClick={() => exportPng(1)} title={`Download PNG (${preset.w}×${preset.h})`}>
                  <Download size={13} /> PNG
                </button>
                <button className="btn -ml-px rounded-none" onClick={() => exportPng(2)} title={`Download PNG at 2× (${preset.w * 2}×${preset.h * 2})`}>
                  @2x
                </button>
                <button className="btn -ml-px rounded-l-none" onClick={() => download(`${preset.id}.svg`, svg, "image/svg+xml")} title="Download SVG">
                  SVG
                </button>
              </div>
              <button className="btn" onClick={() => save().catch((e) => log("error", "graphics", `Couldn’t save: ${e instanceof Error ? e.message : e}`))} title="Save to the deliverables library">
                <Save size={13} /> Save
              </button>
            </>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @3xl:grid-cols-[300px_minmax(0,1fr)] @3xl:grid-rows-[minmax(0,1fr)] @3xl:overflow-hidden">
        <aside aria-label="Brief" className="min-w-0 space-y-3 border-b border-line bg-side px-4 pb-4 pt-3 @3xl:overflow-y-auto @3xl:border-b-0 @3xl:border-r">
          <h2 className="section-title">Design</h2>
          <div>
            <label className="label" htmlFor="gx-format">
              Format
            </label>
            <select id="gx-format" className="input" value={preset.id} onChange={(e) => setPreset(PRESETS.find((p) => p.id === e.target.value)!)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.w}×{p.h})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="gx-brief">
              Brief
            </label>
            <textarea
              id="gx-brief"
              className="input"
              rows={7}
              placeholder="Launch announcement: dark background, bold headline “Your AI company in one window”, subtle grid…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="help">{svg ? "Describe a change and choose Refine to revise the current graphic." : "Describe the message, layout, colors and text."}</p>
          </div>
          <div>
            <span className="label">Agent</span>
            <AgentPicker value={provider} onChange={setProvider} department="design" className="input" title="Agent that designs the graphic" />
          </div>
          <div className="flex gap-2 pt-1">
            {runId ? (
              <button className="btn flex-1" onClick={stop}>
                <Square size={11} /> Stop
              </button>
            ) : (
              <>
                <button className={`btn flex-1 ${svg ? "" : "btn-primary"}`} onClick={() => generate(false)} disabled={!prompt.trim()} title={prompt.trim() ? "Generate a new graphic" : "Write a brief first"}>
                  <Sparkles size={13} /> Generate
                </button>
                <button className={`btn flex-1 ${svg ? "btn-primary" : ""}`} onClick={() => generate(true)} disabled={!svg || !prompt.trim()} title="Revise the current graphic">
                  <Wand2 size={13} /> Refine
                </button>
              </>
            )}
          </div>
        </aside>

        <section aria-label="Preview" className="flex min-h-[420px] min-w-0 flex-col @3xl:min-h-0">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
            <span className="text-[12px] text-muted">{preset.label}</span>
            <span className="text-[11px] tabular-nums text-faint">
              {preset.w}×{preset.h}
            </span>
            <div className="flex-1" />
            {runId && <span className="caret text-[12px] text-muted">Designing</span>}
            <button className="icon-btn" onClick={() => setShowCode((v) => !v)} disabled={!svg} aria-pressed={showCode} aria-label="Edit SVG code" title={showCode ? "Hide SVG code" : "Edit SVG code"}>
              <Code size={14} />
            </button>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center p-6"
            style={{
              backgroundImage: "repeating-conic-gradient(color-mix(in srgb, var(--fg) 6%, transparent) 0 25%, transparent 0 50%)",
              backgroundSize: "20px 20px",
            }}
          >
            {svg ? (
              <img alt="Graphic preview" src={svgDataUrl(svg)} className="max-h-full max-w-full border border-line" style={{ aspectRatio: `${preset.w}/${preset.h}` }} />
            ) : runId ? (
              <div className="card w-full max-w-lg p-3" aria-live="polite">
                <div className="caret mb-2 text-[12px] text-muted">Designing</div>
                <pre className="max-h-60 overflow-hidden whitespace-pre-wrap font-mono text-[11px] text-faint">{raw.slice(-1200) || "Waiting for the agent…"}</pre>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="grid place-items-center rounded-[6px] border border-dashed border-line text-faint" style={{ width: 240, height: Math.min(320, (240 * preset.h) / preset.w) }}>
                  <ImageIcon size={22} strokeWidth={1.5} aria-hidden />
                </div>
                <div className="text-[13px] font-medium">No graphic yet</div>
                <p className="max-w-[300px] text-[12px] text-muted">Write a brief and choose Generate. The agent returns an editable SVG.</p>
              </div>
            )}
          </div>
          {showCode && svg && (
            <textarea
              aria-label="SVG code"
              spellCheck={false}
              className="h-56 shrink-0 resize-y border-t border-line bg-editor p-3 font-mono text-[11.5px]"
              style={{ outline: "none" }}
              value={svg}
              onChange={(e) => setSvg(e.target.value)}
            />
          )}
        </section>
      </div>
    </div>
  );
}
