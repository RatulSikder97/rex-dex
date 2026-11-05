"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Film, ImageIcon, Play, Sparkles, Trash2, X } from "lucide-react";
import { api, bytes } from "@/lib/client";
import type { ProviderId } from "@/lib/types";
import AgentPicker from "@/components/AgentPicker";
import OpenInApps from "@/components/OpenInApps";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { ErrorState } from "@/components/ui/kit";
import { EmptyState, Skeleton } from "@/components/ui/empty";

interface MediaFile { name: string; size: number; modified: number; kind: "video" | "audio" | "image" }
interface Probe { duration: number; width: number | null; height: number | null; hasAudio: boolean; videoCodec: string | null; fps: number | null }
type Op = { op: string; [k: string]: unknown };

const OP_TEMPLATES: Record<string, { label: string; make: (p: { cur: number; dur: number }) => Op }> = {
  trim: { label: "Trim", make: ({ cur, dur }) => ({ op: "trim", start: Math.round(cur * 10) / 10, end: Math.min(dur, Math.round((cur + 10) * 10) / 10) }) },
  reframe: { label: "Reframe (9:16, 1:1…)", make: () => ({ op: "reframe", aspect: "9:16", mode: "crop" }) },
  text: { label: "Text overlay", make: () => ({ op: "text", text: "Your headline", position: "bottom", fontSize: 56 }) },
  captions: { label: "Burn captions (SRT)", make: () => ({ op: "captions", srt: "1\n00:00:00,000 --> 00:00:03,000\nFirst caption\n" }) },
  speed: { label: "Speed", make: () => ({ op: "speed", factor: 1.5 }) },
  fade: { label: "Fade in/out", make: () => ({ op: "fade", fadeIn: 0.5, fadeOut: 0.5 }) },
  concat: { label: "Append clips", make: () => ({ op: "concat", others: [] }) },
  mute: { label: "Mute", make: () => ({ op: "mute" }) },
  compress: { label: "Compress", make: () => ({ op: "compress", crf: 28, maxWidth: 1920 }) },
  thumbnail: { label: "Thumbnail (jpg)", make: ({ cur }) => ({ op: "thumbnail", at: Math.round(cur * 10) / 10 }) },
  gif: { label: "GIF", make: ({ cur }) => ({ op: "gif", start: Math.round(cur * 10) / 10, duration: 4, width: 480 }) },
  extractAudio: { label: "Extract audio (mp3)", make: () => ({ op: "extractAudio" }) },
};

/** "fadeIn" → "Fade in", "maxWidth" → "Max width" (sentence case field labels). */
const FIELD_LABEL: Record<string, string> = { srt: "Captions (SRT)", crf: "Quality (CRF, lower is better)", others: "Clips to append", at: "At (seconds)", fontSize: "Font size" };
const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c: string) => ` ${c.toLowerCase()}`);

const ENUMS: Record<string, string[]> = { aspect: ["9:16", "1:1", "16:9", "4:5"], mode: ["crop", "pad"], position: ["top", "center", "bottom"] };

export default function VideoView({ file }: { file?: string }) {
  const project = useActiveProject();
  const { log, bump, version, openTab } = useWorkbench();
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [mediaState, setMediaState] = useState<"loading" | "ready" | "error">("loading");
  const [mediaError, setMediaError] = useState<unknown>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | undefined>(file);
  const [info, setInfo] = useState<Probe | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [busy, setBusy] = useState<"render" | "plan" | null>(null);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [notes, setNotes] = useState("");
  const [provider, setProvider] = useState<ProviderId | "">("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    api<MediaFile[]>("/api/media")
      .then((m) => {
        setMedia(m);
        setMediaState("ready");
        setSelected((s) => s ?? m.find((x) => x.kind === "video")?.name);
      })
      .catch((e) => {
        setMediaError(e);
        setMediaState((st) => (st === "ready" ? st : "error"));
      });
  }, [version, reload]);
  useEffect(() => setSelected(file ?? undefined), [file]);
  useEffect(() => {
    setInfo(null);
    setProbeError(null);
    if (!selected) return;
    const kind = media.find((m) => m.name === selected)?.kind;
    if (kind === "image") return;
    api<Probe>(`/api/media/${encodeURIComponent(selected)}?probe=1`)
      .then(setInfo)
      .catch((e) => setProbeError(e instanceof Error ? e.message : String(e)));
  }, [selected, media]);

  const current = media.find((m) => m.name === selected);
  const src = selected ? `/api/media/${encodeURIComponent(selected)}` : "";
  const videos = useMemo(() => media.filter((m) => m.kind === "video"), [media]);

  const addOp = (key: string) => {
    const cur = videoRef.current?.currentTime ?? 0;
    setOps((o) => [...o, OP_TEMPLATES[key].make({ cur, dur: info?.duration ?? 10 })]);
  };

  const render = async () => {
    if (!selected || !ops.length) return;
    setBusy("render");
    log("info", "video", `Rendering ${ops.length} step(s) on ${selected}…`);
    try {
      const res = await api<{ outputs: string[]; final: string }>("/api/video", { method: "POST", json: { input: selected, ops } });
      setOutputs(res.outputs);
      log("ok", "video", `Rendered ${res.final}`);
      bump();
    } catch (e) {
      log("error", "video", String(e));
    } finally {
      setBusy(null);
    }
  };

  const plan = async () => {
    if (!selected || !instruction.trim()) return;
    setBusy("plan");
    log("info", "video", `AI planning edit: ${instruction.slice(0, 80)}`);
    try {
      const res = await api<{ ops: Op[]; notes: string }>("/api/video/plan", {
        method: "POST",
        json: { input: selected, instruction, provider: provider || null, projectId: project?.id ?? null },
      });
      setOps(res.ops);
      setNotes(res.notes);
      log("ok", "video", `AI proposed ${res.ops.length} step(s). Review, then Render.`);
    } catch (e) {
      log("error", "video", String(e));
    } finally {
      setBusy(null);
    }
  };

  const setField = (i: number, key: string, value: unknown) => setOps((o) => o.map((op, j) => (j === i ? { ...op, [key]: value } : op)));
  const move = (i: number, d: number) =>
    setOps((o) => {
      const n = [...o];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x);
      return n;
    });

  const meta = info
    ? `${info.duration.toFixed(1)}s · ${info.width}×${info.height} · ${info.fps ?? "?"} fps · ${info.videoCodec ?? "audio"} · ${info.hasAudio ? "audio" : "no audio"}${current ? ` · ${bytes(current.size)}` : ""}`
    : "";
  const renderHint = !selected ? "Pick a file first" : !ops.length ? "Add at least one step" : `Run ${ops.length} step${ops.length === 1 ? "" : "s"} with ffmpeg`;

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-editor">
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2">
        <h1 className="page-title shrink-0">Video editor</h1>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {selected && <OpenInApps media={selected} className="btn" />}
          {selected && (
            <a className="btn" href={`${src}?download=1`} title={`Download ${selected}`}>
              <Download size={13} /> Download
            </a>
          )}
          <button className="btn btn-primary" onClick={render} disabled={!selected || !ops.length || busy !== null} title={renderHint}>
            <Play size={13} /> {busy === "render" ? "Rendering…" : "Render"}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @3xl:grid-cols-[minmax(0,1fr)_320px] @3xl:grid-rows-[minmax(0,1fr)] @3xl:overflow-hidden @5xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* preview */}
        <section aria-label="Preview" className="flex min-h-[360px] min-w-0 flex-col @3xl:min-h-0">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
            <label htmlFor="vv-file" className="sr-only">
              Media file
            </label>
            <select
              id="vv-file"
              className="input input-sm w-52 min-w-0 shrink"
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value || undefined)}
              disabled={!media.length}
              title={selected}
            >
              {!media.length && <option value="">No media</option>}
              {media.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            {meta ? (
              <span className="min-w-0 truncate text-[11px] tabular-nums text-muted" title={meta}>
                {meta}
              </span>
            ) : probeError ? (
              <span className="min-w-0 truncate text-[11px] text-err" title={probeError}>
                Couldn’t read this file: {probeError}
              </span>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-bg">
            {mediaState === "loading" ? (
              <Skeleton className="aspect-video w-2/3 max-w-[640px]" />
            ) : mediaState === "error" ? (
              <ErrorState
                title="Couldn’t load the media library"
                error={mediaError}
                onRetry={() => {
                  setMediaState("loading");
                  setReload((n) => n + 1);
                }}
              />
            ) : !selected ? (
              <EmptyState icon={Film} title="No media yet" hint="Import a video from the Video sidebar, or produce one in Create studio." action={{ label: "Open Create studio", onClick: () => openTab({ kind: "create" }, "Create studio") }} />
            ) : current?.kind === "image" ? (
              <img alt={selected} src={src} className="max-h-full max-w-full" />
            ) : current?.kind === "audio" ? (
              <audio src={src} controls />
            ) : (
              <video key={src} ref={videoRef} src={src} controls className="max-h-full max-w-full" />
            )}
          </div>
          {outputs.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
              <span className="section-title mr-1">Outputs</span>
              {outputs.map((o) => (
                <button key={o} className="btn btn-sm max-w-[220px]" onClick={() => setSelected(o)} aria-pressed={o === selected} title={`Preview ${o}`}>
                  <Play size={11} className="shrink-0" /> <span className="truncate">{o}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* edit pipeline */}
        <aside aria-label="Edit" className="flex min-w-0 flex-col border-t border-line bg-side @3xl:min-h-0 @3xl:border-l @3xl:border-t-0">
          <section className="space-y-2 border-b border-line px-3 pb-3 pt-3">
            <h2 className="section-title">Describe the edit</h2>
            <label htmlFor="vv-instruction" className="sr-only">
              Edit instruction
            </label>
            <textarea
              id="vv-instruction"
              className="input"
              rows={3}
              placeholder="Cut 0:05–0:35, make it 9:16, add the headline “Ship faster” at the top, fade in and out, then compress"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <AgentPicker value={provider} onChange={setProvider} department="video" className="input input-sm" title="Agent that plans the edit" />
              </div>
              <button className="btn btn-sm shrink-0" onClick={plan} disabled={!selected || !instruction.trim() || busy !== null} title="Turn the description into pipeline steps">
                <Sparkles size={13} /> {busy === "plan" ? "Planning…" : "Plan steps"}
              </button>
            </div>
            {notes && <p className="help">{notes}</p>}
            <button className="btn btn-ghost btn-sm -ml-2" onClick={() => openTab({ kind: "graphics" }, "Graphics studio")} title="Design a thumbnail in Graphics studio">
              <ImageIcon size={13} /> Design a thumbnail
            </button>
          </section>

          <div className="flex h-9 shrink-0 items-center gap-1.5 px-3">
            <h2 className="section-title flex-1">
              Steps {ops.length > 0 && <span className="count ml-1 normal-case">{ops.length}</span>}
            </h2>
            <label htmlFor="vv-add" className="sr-only">
              Add step
            </label>
            <select id="vv-add" className="input input-sm w-36" value="" onChange={(e) => e.target.value && addOp(e.target.value)}>
              <option value="">Add step…</option>
              {Object.entries(OP_TEMPLATES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => setOps([])} disabled={!ops.length} aria-label="Clear all steps" title="Clear all steps">
              <Trash2 size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 px-3 pb-3 @3xl:overflow-y-auto">
            {ops.map((op, i) => {
              const label = OP_TEMPLATES[op.op]?.label ?? op.op;
              return (
                <div key={i} className="card bg-editor">
                  <div className="flex h-8 items-center gap-1 border-b border-line pl-2.5 pr-1">
                    <span className="w-4 text-[11px] tabular-nums text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" title={label}>
                      {label}
                    </span>
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`} title="Move up">
                      <ArrowUp size={13} />
                    </button>
                    <button className="icon-btn" disabled={i === ops.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`} title="Move down">
                      <ArrowDown size={13} />
                    </button>
                    <button className="icon-btn" onClick={() => setOps((o) => o.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`} title="Remove step">
                      <X size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-2.5">
                    {Object.entries(op)
                      .filter(([k]) => k !== "op")
                      .map(([k, v]) => (
                        <label key={k} className={`min-w-0 ${k === "srt" || k === "text" || k === "others" ? "col-span-2" : ""}`}>
                          <span className="label truncate" title={fieldLabel(k)}>
                            {fieldLabel(k)}
                          </span>
                          {ENUMS[k] ? (
                            <select className="input input-sm" value={String(v)} onChange={(e) => setField(i, k, e.target.value)}>
                              {ENUMS[k].map((x) => (
                                <option key={x}>{x}</option>
                              ))}
                            </select>
                          ) : k === "others" ? (
                            <select
                              className="input h-auto"
                             
                              multiple
                              value={v as string[]}
                              onChange={(e) => setField(i, k, Array.from(e.target.selectedOptions).map((o) => o.value))}
                            >
                              {videos.filter((m) => m.name !== selected).map((m) => (
                                <option key={m.name}>{m.name}</option>
                              ))}
                            </select>
                          ) : k === "srt" ? (
                            <textarea className="input font-mono text-[11px]" rows={5} value={String(v)} onChange={(e) => setField(i, k, e.target.value)} />
                          ) : typeof v === "number" ? (
                            <input className="input input-sm" type="number" step="0.1" value={v} onChange={(e) => setField(i, k, Number(e.target.value))} />
                          ) : (
                            <input className="input input-sm" value={String(v ?? "")} onChange={(e) => setField(i, k, e.target.value)} />
                          )}
                        </label>
                      ))}
                  </div>
                </div>
              );
            })}
            {!ops.length && (
              <p className="py-2 text-[12px] leading-relaxed text-muted">
                Add steps, or describe the edit and choose Plan steps. Each step runs on the previous result with ffmpeg, and every intermediate file is kept in your media library.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
