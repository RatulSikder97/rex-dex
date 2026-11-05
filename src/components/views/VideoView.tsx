"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Play, Sparkles, Trash2, X } from "lucide-react";
import { api, bytes } from "@/lib/client";
import type { ProviderId } from "@/lib/types";
import AgentPicker from "@/components/AgentPicker";
import OpenInApps from "@/components/OpenInApps";
import { useActiveProject, useWorkbench } from "@/store/workbench";

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

const ENUMS: Record<string, string[]> = { aspect: ["9:16", "1:1", "16:9", "4:5"], mode: ["crop", "pad"], position: ["top", "center", "bottom"] };

export default function VideoView({ file }: { file?: string }) {
  const project = useActiveProject();
  const { log, bump, version, openTab } = useWorkbench();
  const [media, setMedia] = useState<MediaFile[]>([]);
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
    api<MediaFile[]>("/api/media").then((m) => {
      setMedia(m);
      setSelected((s) => s ?? m.find((x) => x.kind === "video")?.name);
    });
  }, [version]);
  useEffect(() => setSelected(file ?? undefined), [file]);
  useEffect(() => {
    setInfo(null);
    if (!selected) return;
    const kind = media.find((m) => m.name === selected)?.kind;
    if (kind === "image") return;
    api<Probe>(`/api/media/${encodeURIComponent(selected)}?probe=1`).then(setInfo).catch((e) => log("error", "video", String(e)));
  }, [selected, media, log]);

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

  return (
    <div className="flex h-full">
      {/* preview */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 items-center gap-2 border-b border-line px-3">
          <select className="input h-7 w-52" value={selected ?? ""} onChange={(e) => setSelected(e.target.value || undefined)}>
            {!media.length && <option value="">Import media from the sidebar</option>}
            {media.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          {info && (
            <span className="truncate text-[11.5px] text-muted">
              {info.duration.toFixed(1)}s · {info.width}×{info.height} · {info.fps ?? "?"} fps · {info.videoCodec ?? "audio"} {info.hasAudio ? "· audio" : "· no audio"}
              {current ? ` · ${bytes(current.size)}` : ""}
            </span>
          )}
          <div className="flex-1" />
          {selected && <OpenInApps media={selected} className="btn" />}
          {selected && (
            <a className="btn" href={`${src}?download=1`}>
              <Download size={13} /> Download
            </a>
          )}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
          {!selected ? (
            <div className="text-muted">Import a video in the Video sidebar to start.</div>
          ) : current?.kind === "image" ? (
            <img alt={selected} src={src} className="max-h-full max-w-full" />
          ) : current?.kind === "audio" ? (
            <audio src={src} controls />
          ) : (
            <video key={src} ref={videoRef} src={src} controls className="max-h-full max-w-full" />
          )}
        </div>
        {outputs.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <span className="text-[11px] text-muted">OUTPUTS</span>
            {outputs.map((o) => (
              <button key={o} className="btn" onClick={() => setSelected(o)}>
                <Play size={11} /> {o}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* edit pipeline */}
      <div className="flex w-[380px] shrink-0 flex-col border-l border-line bg-side">
        <div className="space-y-2 border-b border-line p-3">
          <div className="section-title">AI edit</div>
          <textarea
            className="input"
            rows={3}
            placeholder={'e.g. "Cut 0:05–0:35, make it 9:16 for Reels, add the headline \'Ship faster\' at the top, fade in/out, then compress"'}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <div className="flex gap-2">
            <AgentPicker value={provider} onChange={setProvider} department="video" />
            <button className="btn btn-primary flex-1 justify-center" onClick={plan} disabled={!selected || !instruction.trim() || busy !== null}>
              <Sparkles size={13} /> {busy === "plan" ? "Planning…" : "Plan edit"}
            </button>
          </div>
          {notes && <p className="text-[12px] text-muted">{notes}</p>}
          <button
            className="btn w-full justify-center"
            onClick={() => openTab({ kind: "graphics" }, "Graphics Studio")}
            title="Design a thumbnail in Graphics Studio"
          >
            Design thumbnail in Graphics Studio
          </button>
        </div>

        <div className="flex items-center justify-between px-3 pt-3">
          <span className="section-title">Pipeline</span>
          <select className="input h-7 w-44 text-[11.5px]" value="" onChange={(e) => e.target.value && addOp(e.target.value)}>
            <option value="">+ Add step…</option>
            {Object.entries(OP_TEMPLATES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {ops.map((op, i) => (
            <div key={i} className="rounded border border-line bg-editor p-2">
              <div className="mb-1.5 flex items-center gap-1">
                <span className="text-[11px] text-faint">{i + 1}.</span>
                <span className="text-[12.5px] font-medium">{OP_TEMPLATES[op.op]?.label ?? op.op}</span>
                <div className="flex-1" />
                <button className="icon-btn h-5 w-5" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={12} />
                </button>
                <button className="icon-btn h-5 w-5" disabled={i === ops.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={12} />
                </button>
                <button className="icon-btn h-5 w-5" onClick={() => setOps((o) => o.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(op)
                  .filter(([k]) => k !== "op")
                  .map(([k, v]) => (
                    <label key={k} className={k === "srt" || k === "text" || k === "others" ? "col-span-2" : ""}>
                      <span className="label">{k}</span>
                      {ENUMS[k] ? (
                        <select className="input h-6" value={String(v)} onChange={(e) => setField(i, k, e.target.value)}>
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
                        <input className="input h-6" type="number" step="0.1" value={v} onChange={(e) => setField(i, k, Number(e.target.value))} />
                      ) : (
                        <input className="input h-6" value={String(v ?? "")} onChange={(e) => setField(i, k, e.target.value)} />
                      )}
                    </label>
                  ))}
              </div>
            </div>
          ))}
          {!ops.length && (
            <p className="text-[12px] leading-relaxed text-muted">
              Add steps manually or describe the edit above. Each step runs on the previous result with ffmpeg; every intermediate file is kept in your media library.
            </p>
          )}
        </div>
        <div className="flex gap-2 border-t border-line p-3">
          <button className="btn" onClick={() => setOps([])} disabled={!ops.length}>
            <Trash2 size={13} /> Clear
          </button>
          <button className="btn btn-primary flex-1 justify-center" onClick={render} disabled={!selected || !ops.length || busy !== null}>
            {busy === "render" ? "Rendering…" : (
              <>
                <Play size={13} /> Render
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
