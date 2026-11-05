"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  Film,
  Mic,
  Play,
  Plus,
  Podcast,
  Save,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { api } from "@/lib/client";
import {
  ASPECTS,
  WORDS_PER_SEC,
  estimateSpeechSec,
  type AnyPlan,
  type Aspect,
  type JobKind,
  type JobOptions,
  type MediaJob,
  type PodcastPlan,
  type Scene,
  type VideoPlan,
  type VoiceoverPlan,
} from "@/lib/media/plan";
import type { ProviderId } from "@/lib/types";
import AgentPicker from "@/components/AgentPicker";
import { useAgents } from "@/store/workbench";
import { useActiveProject, useWorkbench } from "@/store/workbench";

interface Voice { id: string; label: string }
interface MediaProvider { id: string; label: string; kind: "tts" | "image"; source: string; available: boolean; detail: string; voices?: Voice[] }
interface MediaFile { name: string; kind: "video" | "audio" | "image" }

interface Preset {
  id: string;
  title: string;
  kind: JobKind;
  aspect?: Aspect;
  targetSeconds?: number;
  style: string;
  brief: string;
  source?: string;
}

const BUILTIN_PRESETS: Preset[] = [
  { id: "explainer-60", title: "60s product explainer (16:9)", kind: "video", aspect: "16:9", targetSeconds: 60, style: "Clear, confident, benefit-led. Problem → solution → how it works → proof → call to action.", brief: "" },
  { id: "reel-30", title: "30s Reel / Short (9:16)", kind: "video", aspect: "9:16", targetSeconds: 30, style: "Punchy hook in the first 2 seconds, short sentences, energetic, ends with a clear call to action.", brief: "" },
  { id: "teaser-15", title: "Launch teaser (1:1, 15s)", kind: "video", aspect: "1:1", targetSeconds: 15, style: "Mysterious build-up, 3–4 quick beats, reveal the name and launch date at the end.", brief: "" },
  { id: "tutorial-vo", title: "Tutorial voiceover", kind: "voiceover", targetSeconds: 90, style: "Friendly instructor. Step-by-step, one action per segment, plain language.", brief: "" },
  { id: "podcast-3m", title: "2-host podcast episode (~3 min)", kind: "podcast", targetSeconds: 180, style: "Conversational and curious. One host explains, the other asks sharp questions and pushes back.", brief: "" },
];

const MODES: { id: JobKind; label: string; icon: typeof Film }[] = [
  { id: "video", label: "Video", icon: Clapperboard },
  { id: "voiceover", label: "Voiceover", icon: Mic },
  { id: "podcast", label: "Podcast", icon: Podcast },
];

const EMPTY_SCENE: Scene = { narration: "", onScreenText: "", visualPrompt: "", durationSec: 5 };

function fmtDur(sec: number): string {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

function estimateTotal(kind: JobKind, plan: AnyPlan | null): number {
  if (!plan) return 0;
  if (kind === "video") return (plan as VideoPlan).scenes.reduce((a, s) => a + Math.max(s.durationSec, s.narration.trim() ? estimateSpeechSec(s.narration) + 0.5 : 0), 0);
  if (kind === "voiceover") {
    const segs = (plan as VoiceoverPlan).segments;
    return segs.reduce((a, s) => a + estimateSpeechSec(s.text), 0) + Math.max(0, segs.length - 1) * 0.35;
  }
  const lines = (plan as PodcastPlan).lines;
  return lines.reduce((a, l) => a + estimateSpeechSec(l.text), 0) + Math.max(0, lines.length - 1) * 0.25;
}

function planToMarkdown(kind: JobKind, plan: AnyPlan): string {
  if (kind === "video") {
    const p = plan as VideoPlan;
    return [
      `# ${p.title}`,
      p.musicMood ? `_Music mood: ${p.musicMood}_` : "",
      ...p.scenes.map(
        (s, i) =>
          `## Scene ${i + 1} · ${s.durationSec}s\n\n**Narration:** ${s.narration || "—"}\n\n**On-screen text:** ${s.onScreenText || "—"}\n\n**Visual:** ${s.visualPrompt || "—"}`,
      ),
    ].filter(Boolean).join("\n\n");
  }
  if (kind === "voiceover") {
    const p = plan as VoiceoverPlan;
    return [`# ${p.title}`, ...p.segments.map((s) => s.text)].join("\n\n");
  }
  const p = plan as PodcastPlan;
  return [`# ${p.title}`, `_Hosts: ${p.hosts[0]} & ${p.hosts[1]}_`, ...p.lines.map((l) => `**${p.hosts[l.speaker] ?? `Host ${l.speaker + 1}`}:** ${l.text}`)].join("\n\n");
}

function emptyPlan(kind: JobKind): AnyPlan {
  if (kind === "video") return { title: "Untitled video", musicMood: "", scenes: [{ ...EMPTY_SCENE }] };
  if (kind === "voiceover") return { title: "Untitled voiceover", segments: [{ text: "" }] };
  return { title: "Untitled episode", hosts: ["Alex", "Sam"], lines: [{ speaker: 0, text: "" }, { speaker: 1, text: "" }] };
}

function move<T>(arr: T[], i: number, d: number): T[] {
  const n = [...arr];
  const [x] = n.splice(i, 1);
  n.splice(i + d, 0, x);
  return n;
}

export default function CreateStudio({ jobId }: { jobId?: string }) {
  const project = useActiveProject();
  const { pluginPipelines, openTab, log, bump, version } = useWorkbench();

  const [mode, setMode] = useState<JobKind>("video");
  const [presetId, setPresetId] = useState("");
  const [brief, setBrief] = useState("");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [style, setStyle] = useState("");
  const [provider, setProvider] = useState<ProviderId | "">("");
  const agents = useAgents();

  const [mediaProviders, setMediaProviders] = useState<MediaProvider[]>([]);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [tts, setTts] = useState("say");
  const [voice, setVoice] = useState("");
  const [voice2, setVoice2] = useState("");
  const [image, setImage] = useState("title-card");
  const [music, setMusic] = useState("ambient");
  const [captions, setCaptions] = useState(true);

  const [plan, setPlan] = useState<AnyPlan | null>(null);
  const [busy, setBusy] = useState<"script" | "produce" | null>(null);
  const [job, setJob] = useState<MediaJob | null>(null);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const prevStatus = useRef<string | null>(null);

  // ---- data
  useEffect(() => {
    api<MediaProvider[]>("/api/media-providers").then(setMediaProviders).catch((e) => log("error", "create", String(e)));
  }, [log]);
  useEffect(() => {
    api<MediaFile[]>("/api/media").then(setMedia).catch(() => {});
  }, [version]);

  const ttsProviders = useMemo(() => mediaProviders.filter((p) => p.kind === "tts"), [mediaProviders]);
  const imageProviders = useMemo(() => mediaProviders.filter((p) => p.kind === "image"), [mediaProviders]);
  const voices = useMemo(() => ttsProviders.find((p) => p.id === tts)?.voices ?? [], [ttsProviders, tts]);

  // Default voices when the provider (or its voice list) changes, unless a loaded job set them.
  useEffect(() => {
    if (!voices.length) return;
    setVoice((v) => (voices.some((x) => x.id === v) ? v : voices[0].id));
    setVoice2((v) => (voices.some((x) => x.id === v) ? v : (voices[1] ?? voices[0]).id));
  }, [voices]);
  useEffect(() => {
    if (!ttsProviders.length) return;
    setTts((t) => (t === "none" || ttsProviders.some((p) => p.id === t && p.available) ? t : (ttsProviders.find((p) => p.available)?.id ?? "none")));
  }, [ttsProviders]);

  const presets: Preset[] = useMemo(
    () => [
      ...BUILTIN_PRESETS,
      ...pluginPipelines.map((p) => ({
        id: `plugin:${p.pluginId}:${p.id}`,
        title: p.title,
        kind: (p.kind === "audio" ? "voiceover" : "video") as JobKind,
        aspect: p.aspect,
        targetSeconds: p.targetSeconds,
        style: p.style,
        brief: p.brief,
        source: p.pluginId,
      })),
    ],
    [pluginPipelines],
  );

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    if (p.kind !== mode) {
      setMode(p.kind);
      setPlan(null);
    }
    if (p.aspect) setAspect(p.aspect);
    if (p.targetSeconds) setTargetSeconds(p.targetSeconds);
    setStyle(p.style);
    if (p.brief) setBrief(p.brief);
  };

  // ---- job loading + polling
  const loadJob = useCallback(async (id: string, hydrate: boolean) => {
    const j = await api<MediaJob>(`/api/create/jobs/${id}`);
    setJob(j);
    if (hydrate) {
      setMode(j.kind);
      setPlan(j.plan);
      setTts(j.options.tts);
      if (j.options.voice) setVoice(j.options.voice);
      if (j.options.voice2) setVoice2(j.options.voice2);
      if (j.options.image) setImage(j.options.image);
      setMusic(j.options.music);
      setCaptions(Boolean(j.options.captions));
      if (j.options.aspect) setAspect(j.options.aspect);
      prevStatus.current = j.status;
    }
    return j;
  }, []);

  useEffect(() => {
    if (!jobId) return;
    loadJob(jobId, true).catch((e) => log("error", "create", `Could not load job: ${e}`));
  }, [jobId, loadJob, log]);

  const jobActive = job?.status === "running" || job?.status === "queued";
  useEffect(() => {
    if (!job || !jobActive) return;
    const t = setInterval(() => {
      loadJob(job.id, false).catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [job?.id, jobActive, loadJob]);

  useEffect(() => {
    if (!job) return;
    const prev = prevStatus.current;
    prevStatus.current = job.status;
    if (prev === job.status || (prev !== "running" && prev !== "queued")) return;
    if (job.status === "done") {
      log("ok", "create", `Produced ${job.output}`);
      bump();
    } else if (job.status === "error") log("error", "create", job.error ?? "Production failed");
    else if (job.status === "cancelled") log("info", "create", `Cancelled "${job.title}"`);
  }, [job, log, bump]);

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.logs, showLog]);

  // ---- actions
  const draft = async () => {
    if (!brief.trim()) return;
    setBusy("script");
    log("info", "create", `Drafting ${mode} script with ${agents.label(provider || agents.forDepartment(mode === "video" ? "video" : "content"))}…`);
    try {
      const p = await api<AnyPlan>("/api/create/script", {
        method: "POST",
        json: { kind: mode, brief, provider: provider || null, projectId: project?.id ?? null, aspect: mode === "video" ? aspect : undefined, targetSeconds, style: style || undefined },
      });
      setPlan(p);
      log("ok", "create", `Script ready: ${p.title}`);
    } catch (e) {
      log("error", "create", `Script failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  const produce = async () => {
    if (!plan) return;
    setBusy("produce");
    const options: JobOptions = {
      tts,
      voice: tts !== "none" ? voice || undefined : undefined,
      voice2: mode === "podcast" ? voice2 || undefined : undefined,
      image: mode === "video" ? image : undefined,
      music,
      captions: mode === "video" ? captions && tts !== "none" : undefined,
      aspect: mode === "video" ? aspect : undefined,
    };
    try {
      const j = await api<MediaJob>("/api/create/jobs", { method: "POST", json: { kind: mode, title: plan.title, plan, options, projectId: project?.id ?? null } });
      prevStatus.current = j.status;
      setJob({ ...j, logs: j.logs ?? "" });
      setShowLog(false);
      log("info", "create", `Producing "${j.title}"…`);
      openTab({ kind: "create", jobId: j.id }, j.title);
      bump();
    } catch (e) {
      log("error", "create", `Could not start job: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!job) return;
    await api(`/api/create/jobs/${job.id}/cancel`, { method: "POST" }).catch((e) => log("error", "create", String(e)));
    loadJob(job.id, false).catch(() => {});
  };

  const saveScript = async () => {
    if (!plan) return;
    try {
      await api("/api/deliverables", {
        method: "POST",
        json: { project_id: project?.id ?? null, department: "video", kind: "markdown", title: `Script: ${plan.title}`, content: planToMarkdown(mode, plan) },
      });
      bump();
      log("ok", "create", `Saved script "${plan.title}" to the library`);
    } catch (e) {
      log("error", "create", String(e));
    }
  };

  const copySrt = async () => {
    if (!job?.srt) return;
    await navigator.clipboard.writeText(job.srt);
    log("ok", "create", "SRT copied to clipboard");
  };

  const switchMode = (m: JobKind) => {
    if (m === mode) return;
    setMode(m);
    setPlan(null);
    setPresetId("");
    if (m === "podcast") setTargetSeconds(180);
    else if (m === "voiceover") setTargetSeconds(60);
    else setTargetSeconds(30);
  };

  const total = estimateTotal(mode, plan);
  const musicFiles = media.filter((m) => m.kind === "audio" || m.kind === "video");
  const selectedTts = ttsProviders.find((p) => p.id === tts);
  const selectedImage = imageProviders.find((p) => p.id === image);
  const needsVoice = mode !== "video";
  const canProduce = Boolean(plan) && busy === null && !jobActive && (!needsVoice || tts !== "none");

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- settings */}
      <div className="flex w-[330px] shrink-0 flex-col border-r border-line bg-side">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => switchMode(m.id)}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] ${mode === m.id ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
            >
              <m.icon size={13} /> {m.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <label className="block">
            <span className="label">Preset</span>
            <select className="input" value={presetId} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">Custom</option>
              <optgroup label="Built-in">
                {BUILTIN_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
              {presets.some((p) => p.source) && (
                <optgroup label="Extensions">
                  {presets.filter((p) => p.source).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="block">
            <span className="label">Brief</span>
            <textarea
              className="input"
              rows={5}
              placeholder={
                mode === "video"
                  ? "What is the video about? Audience, product, key message, call to action…"
                  : mode === "voiceover"
                    ? "What should the voiceover say? Topic, audience, key points…"
                    : "Episode topic, angle, and the points the hosts should cover…"
              }
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {mode === "video" && (
              <label>
                <span className="label">Aspect</span>
                <select className="input" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
                  {ASPECTS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
            )}
            <label className={mode === "video" ? "" : "col-span-2"}>
              <span className="label">Target length (sec)</span>
              <input className="input" type="number" min={5} max={900} step={5} value={targetSeconds} onChange={(e) => setTargetSeconds(Math.max(5, Math.min(900, Number(e.target.value) || 5)))} />
            </label>
          </div>
          <label className="block">
            <span className="label">Style</span>
            <textarea className="input" rows={2} placeholder="Tone, pacing, voice…" value={style} onChange={(e) => setStyle(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <AgentPicker value={provider} onChange={setProvider} department={mode === "video" ? "video" : "content"} className="input w-auto text-[11.5px]" title="AI writer (terminal agent)" />
            <button className="btn btn-primary flex-1 justify-center" onClick={draft} disabled={!brief.trim() || busy !== null}>
              <Sparkles size={13} /> {busy === "script" ? "Drafting…" : "Draft script"}
            </button>
          </div>

          <div className="section-title pt-2">Production</div>
          <label className="block">
            <span className="label">Voice provider</span>
            <select className="input" value={tts} onChange={(e) => setTts(e.target.value)}>
              {mode === "video" && <option value="none">None (silent)</option>}
              {ttsProviders.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {p.available ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
            {selectedTts && !selectedTts.available && <span className="mt-1 block text-[11px] text-warn">{selectedTts.detail}</span>}
          </label>
          {tts !== "none" && voices.length > 0 && (
            <div className={mode === "podcast" ? "grid grid-cols-2 gap-2" : ""}>
              <label className="block">
                <span className="label">{mode === "podcast" ? `Voice · ${(plan as PodcastPlan | null)?.hosts?.[0] ?? "Host 1"}` : "Voice"}</span>
                <select className="input" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              {mode === "podcast" && (
                <label className="block">
                  <span className="label">Voice · {(plan as PodcastPlan | null)?.hosts?.[1] ?? "Host 2"}</span>
                  <select className="input" value={voice2} onChange={(e) => setVoice2(e.target.value)}>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {mode === "video" && (
            <label className="block">
              <span className="label">Images</span>
              <select className="input" value={image} onChange={(e) => setImage(e.target.value)}>
                {imageProviders.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label}
                    {p.available ? "" : " (unavailable)"}
                  </option>
                ))}
              </select>
              {selectedImage && <span className={`mt-1 block text-[11px] ${selectedImage.available ? "text-faint" : "text-warn"}`}>{selectedImage.detail}</span>}
            </label>
          )}
          <label className="block">
            <span className="label">{mode === "podcast" ? "Intro / outro music" : "Music bed"}</span>
            <select className="input" value={music} onChange={(e) => setMusic(e.target.value)}>
              <option value="none">None</option>
              <option value="ambient">Ambient (generated)</option>
              {musicFiles.length > 0 && (
                <optgroup label="Media library">
                  {musicFiles.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {mode === "video" && (
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={captions} disabled={tts === "none"} onChange={(e) => setCaptions(e.target.checked)} />
              Burn in captions (also saved as SRT)
            </label>
          )}
        </div>
      </div>

      {/* ---------------- plan + production */}
      <div className="flex min-w-0 flex-1 flex-col bg-editor">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
          {plan ? (
            <input
              className="input h-7 min-w-[180px] max-w-[420px] flex-1 font-medium"
              value={plan.title}
              onChange={(e) => setPlan({ ...plan, title: e.target.value } as AnyPlan)}
              aria-label="Title"
            />
          ) : (
            <span className="text-[12.5px] text-muted">Create Studio</span>
          )}
          {plan && (
            <span className="shrink-0 text-[11.5px] text-muted" title={`Estimated at ${WORDS_PER_SEC} words/sec`}>
              ≈ {fmtDur(total)} total
            </span>
          )}
          <div className="flex-1" />
          {!plan && (
            <button className="btn" onClick={() => setPlan(emptyPlan(mode))}>
              <Plus size={13} /> Write manually
            </button>
          )}
          {plan && (
            <button className="btn" onClick={saveScript} title="Save the script to the deliverables library">
              <Save size={13} /> Save script as deliverable
            </button>
          )}
          {jobActive ? (
            <button className="btn" onClick={cancel}>
              <Square size={12} /> Cancel
            </button>
          ) : (
            <button className="btn btn-primary" onClick={produce} disabled={!canProduce}>
              <Play size={13} /> {busy === "produce" ? "Starting…" : "Produce"}
            </button>
          )}
        </div>

        {job && <JobStatusBar job={job} showLog={showLog} setShowLog={setShowLog} logRef={logRef} onOpenEditor={(file) => openTab({ kind: "video", file }, "Video Editor")} onCopySrt={copySrt} />}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!plan ? (
            <div className="mx-auto mt-16 max-w-md text-center text-muted">
              <Sparkles size={22} className="mx-auto mb-3 text-faint" />
              <p className="text-[13px]">Pick a preset, write a brief, then <b className="text-fg">Draft script</b>.</p>
              <p className="mt-1 text-[12px]">You can edit every line before producing.</p>
            </div>
          ) : mode === "video" ? (
            <VideoEditor plan={plan as VideoPlan} setPlan={setPlan} />
          ) : mode === "voiceover" ? (
            <VoiceoverEditor plan={plan as VoiceoverPlan} setPlan={setPlan} />
          ) : (
            <PodcastEditor plan={plan as PodcastPlan} setPlan={setPlan} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function JobStatusBar({
  job,
  showLog,
  setShowLog,
  logRef,
  onOpenEditor,
  onCopySrt,
}: {
  job: MediaJob;
  showLog: boolean;
  setShowLog: (v: boolean) => void;
  logRef: React.RefObject<HTMLPreElement | null>;
  onOpenEditor: (file: string) => void;
  onCopySrt: () => void;
}) {
  const color = job.status === "done" ? "bg-ok" : job.status === "error" ? "bg-err" : job.status === "cancelled" ? "bg-faint" : "bg-accent";
  const src = job.output ? `/api/media/${encodeURIComponent(job.output)}` : "";
  const isVideo = job.output?.endsWith(".mp4");
  return (
    <div className="shrink-0 border-b border-line bg-side">
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-muted">{job.status}</span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-elev">
          <div className={`h-full ${color} transition-[width] duration-500`} style={{ width: `${job.status === "done" ? 100 : job.progress}%` }} />
        </div>
        <span className="w-10 shrink-0 text-right text-[11px] text-muted">{job.status === "done" ? 100 : job.progress}%</span>
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <button className="icon-btn h-5 w-5" onClick={() => setShowLog(!showLog)} title="Toggle log">
          {showLog ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className={`min-w-0 flex-1 truncate text-[12px] ${job.status === "error" ? "text-err" : "text-muted"}`}>
          {job.status === "error" ? job.error : job.step}
        </span>
      </div>
      {showLog && (
        <pre ref={logRef} className="mx-3 mb-2 max-h-48 overflow-auto rounded border border-line bg-editor p-2 font-mono text-[11px] leading-relaxed text-muted">
          {job.logs || "No log yet."}
        </pre>
      )}
      {job.status === "done" && job.output && (
        <div className="flex flex-wrap items-start gap-3 border-t border-line px-3 py-3">
          {isVideo ? (
            <video key={src} src={src} controls className="max-h-[360px] max-w-full rounded bg-black" />
          ) : (
            <audio key={src} src={src} controls className="w-full max-w-md" />
          )}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11.5px] text-fg">{job.output}</span>
            {isVideo && (
              <button className="btn" onClick={() => onOpenEditor(job.output!)}>
                <Film size={13} /> Open in Video Editor
              </button>
            )}
            <a className="btn" href={`${src}?download=1`}>
              <Download size={13} /> Download
            </a>
            {job.srt && (
              <button className="btn" onClick={onCopySrt}>
                <Copy size={13} /> Copy SRT
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RowActions({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (d: number) => void; onRemove: () => void }) {
  return (
    <>
      <button className="icon-btn h-5 w-5" disabled={i === 0} onClick={() => onMove(-1)} title="Move up">
        <ArrowUp size={12} />
      </button>
      <button className="icon-btn h-5 w-5" disabled={i === n - 1} onClick={() => onMove(1)} title="Move down">
        <ArrowDown size={12} />
      </button>
      <button className="icon-btn h-5 w-5" disabled={n <= 1} onClick={onRemove} title="Remove">
        <X size={12} />
      </button>
    </>
  );
}

function VideoEditor({ plan, setPlan }: { plan: VideoPlan; setPlan: (p: AnyPlan) => void }) {
  const setScene = (i: number, patch: Partial<Scene>) => setPlan({ ...plan, scenes: plan.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <label className="flex max-w-sm items-center gap-2">
        <span className="label mb-0 shrink-0">Music mood</span>
        <input className="input h-7" value={plan.musicMood} onChange={(e) => setPlan({ ...plan, musicMood: e.target.value })} />
      </label>
      {plan.scenes.map((s, i) => {
        const speech = estimateSpeechSec(s.narration);
        const over = speech + 0.5 > s.durationSec;
        return (
          <div key={i} className="card p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[12.5px] font-medium">Scene {i + 1}</span>
              <span className={`text-[11px] ${over ? "text-warn" : "text-faint"}`} title="Narration is spoken at about 2.5 words/sec; the scene stretches to fit it">
                ~{speech.toFixed(1)}s speech
              </span>
              <div className="flex-1" />
              <label className="flex items-center gap-1 text-[11px] text-muted">
                Duration
                <input
                  className="input h-6 w-16"
                  type="number"
                  min={1}
                  max={120}
                  step={0.5}
                  value={s.durationSec}
                  onChange={(e) => setScene(i, { durationSec: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
                />
                s
              </label>
              <RowActions
                i={i}
                n={plan.scenes.length}
                onMove={(d) => setPlan({ ...plan, scenes: move(plan.scenes, i, d) })}
                onRemove={() => setPlan({ ...plan, scenes: plan.scenes.filter((_, j) => j !== i) })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2">
                <span className="label">Narration</span>
                <textarea className="input" rows={2} value={s.narration} onChange={(e) => setScene(i, { narration: e.target.value })} />
              </label>
              <label>
                <span className="label">On-screen text</span>
                <input className="input" value={s.onScreenText} onChange={(e) => setScene(i, { onScreenText: e.target.value })} />
              </label>
              <label>
                <span className="label">Visual prompt</span>
                <input className="input" value={s.visualPrompt} onChange={(e) => setScene(i, { visualPrompt: e.target.value })} />
              </label>
            </div>
          </div>
        );
      })}
      <button className="btn" onClick={() => setPlan({ ...plan, scenes: [...plan.scenes, { ...EMPTY_SCENE }] })} disabled={plan.scenes.length >= 40}>
        <Plus size={13} /> Add scene
      </button>
    </div>
  );
}

function VoiceoverEditor({ plan, setPlan }: { plan: VoiceoverPlan; setPlan: (p: AnyPlan) => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      {plan.segments.map((s, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="w-6 shrink-0 pt-1.5 text-right text-[11px] text-faint">{i + 1}</span>
          <textarea
            className="input flex-1"
            rows={2}
            value={s.text}
            onChange={(e) => setPlan({ ...plan, segments: plan.segments.map((x, j) => (j === i ? { text: e.target.value } : x)) })}
          />
          <div className="flex shrink-0 flex-col items-center pt-0.5">
            <span className="text-[10.5px] text-faint">{estimateSpeechSec(s.text).toFixed(1)}s</span>
            <div className="flex">
              <RowActions
                i={i}
                n={plan.segments.length}
                onMove={(d) => setPlan({ ...plan, segments: move(plan.segments, i, d) })}
                onRemove={() => setPlan({ ...plan, segments: plan.segments.filter((_, j) => j !== i) })}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="btn ml-8" onClick={() => setPlan({ ...plan, segments: [...plan.segments, { text: "" }] })}>
        <Plus size={13} /> Add segment
      </button>
    </div>
  );
}

function PodcastEditor({ plan, setPlan }: { plan: PodcastPlan; setPlan: (p: AnyPlan) => void }) {
  const setLine = (i: number, patch: Partial<PodcastPlan["lines"][number]>) => setPlan({ ...plan, lines: plan.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <div className="mb-3 flex gap-2">
        {[0, 1].map((h) => (
          <label key={h} className="flex flex-1 items-center gap-2">
            <span className="label mb-0 shrink-0">Host {h + 1}</span>
            <input
              className="input h-7"
              value={plan.hosts[h]}
              onChange={(e) => setPlan({ ...plan, hosts: (h === 0 ? [e.target.value, plan.hosts[1]] : [plan.hosts[0], e.target.value]) as [string, string] })}
            />
          </label>
        ))}
      </div>
      {plan.lines.map((l, i) => (
        <div key={i} className="flex items-start gap-2">
          <button
            className={`mt-0.5 h-7 w-24 shrink-0 truncate rounded border px-2 text-[11.5px] ${l.speaker === 0 ? "border-accent text-accent" : "border-line text-ok"}`}
            onClick={() => setLine(i, { speaker: l.speaker === 0 ? 1 : 0 })}
            title="Toggle speaker"
          >
            {plan.hosts[l.speaker] || `Host ${l.speaker + 1}`}
          </button>
          <textarea className="input flex-1" rows={2} value={l.text} onChange={(e) => setLine(i, { text: e.target.value })} />
          <div className="flex shrink-0 pt-1">
            <RowActions
              i={i}
              n={plan.lines.length}
              onMove={(d) => setPlan({ ...plan, lines: move(plan.lines, i, d) })}
              onRemove={() => setPlan({ ...plan, lines: plan.lines.filter((_, j) => j !== i) })}
            />
          </div>
        </div>
      ))}
      <button
        className="btn ml-[104px]"
        onClick={() => setPlan({ ...plan, lines: [...plan.lines, { speaker: plan.lines.length ? (plan.lines[plan.lines.length - 1].speaker === 0 ? 1 : 0) : 0, text: "" }] })}
      >
        <Plus size={13} /> Add line
      </button>
    </div>
  );
}
