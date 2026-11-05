"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Save, Sparkles, Square } from "lucide-react";
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

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-4">
        <h1 className="text-[15px] font-semibold">Graphics Studio</h1>
        <label>
          <span className="label">Format</span>
          <select className="input" value={preset.id} onChange={(e) => setPreset(PRESETS.find((p) => p.id === e.target.value)!)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.w}×{p.h})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Brief</span>
          <textarea
            className="input"
            rows={7}
            placeholder={'e.g. "Launch announcement for REX: dark background, bold headline \'Your AI company in one window\', subtle grid, accent #3574f0"'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label>
          <span className="label">Agent</span>
          <AgentPicker value={provider} onChange={setProvider} department="design" className="input" />
        </label>
        <div className="flex gap-2">
          {runId ? (
            <button className="btn flex-1 justify-center" onClick={() => api(`/api/runs/${runId}/cancel`, { method: "POST" })}>
              <Square size={11} /> Stop
            </button>
          ) : (
            <>
              <button className="btn btn-primary flex-1 justify-center" onClick={() => generate(false)} disabled={!prompt.trim()}>
                <Sparkles size={13} /> Generate
              </button>
              <button className="btn flex-1 justify-center" onClick={() => generate(true)} disabled={!svg || !prompt.trim()}>
                Refine
              </button>
            </>
          )}
        </div>
        {svg && (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="grid grid-cols-2 gap-2">
              <button className="btn justify-center" onClick={() => exportPng(1)}>
                <Download size={13} /> PNG
              </button>
              <button className="btn justify-center" onClick={() => exportPng(2)}>
                <Download size={13} /> PNG @2x
              </button>
              <button className="btn justify-center" onClick={() => download(`${preset.id}.svg`, svg, "image/svg+xml")}>
                <Download size={13} /> SVG
              </button>
              <button className="btn justify-center" onClick={save}>
                <Save size={13} /> Save
              </button>
            </div>
            <button className="btn w-full justify-center" onClick={() => setShowCode((s) => !s)}>
              {showCode ? "Hide" : "Edit"} SVG code
            </button>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-8">
          {svg ? (
            <img alt="Graphic preview" src={svgDataUrl(svg)} className="max-h-full max-w-full shadow-2xl" style={{ aspectRatio: `${preset.w}/${preset.h}` }} />
          ) : runId ? (
            <div className="max-w-lg text-center text-muted">
              <div className="caret">Designing</div>
              <pre className="mt-3 max-h-60 overflow-hidden text-left font-mono text-[10.5px] text-faint whitespace-pre-wrap">{raw.slice(-1200)}</pre>
            </div>
          ) : (
            <div className="text-center text-muted">
              <div className="mx-auto mb-3 rounded border border-dashed border-line" style={{ width: 240, height: (240 * preset.h) / preset.w }} />
              {preset.w}×{preset.h} canvas
            </div>
          )}
        </div>
        {showCode && svg && (
          <textarea className="h-56 shrink-0 resize-y border-t border-line bg-editor p-3 font-mono text-[11.5px] outline-none" value={svg} onChange={(e) => setSvg(e.target.value)} />
        )}
      </div>
    </div>
  );
}
