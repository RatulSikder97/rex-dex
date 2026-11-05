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
import { ErrorState, Pill, Segmented, type Tone } from "@/components/ui/kit";
import { EmptyState, Skeleton } from "@/components/ui/empty";
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
  { id: "reel-30", title: "30s reel / short (9:16)", kind: "video", aspect: "9:16", targetSeconds: 30, style: "Punchy hook in the first 2 seconds, short sentences, energetic, ends with a clear call to action.", brief: "" },
  { id: "teaser-15", title: "Launch teaser (1:1, 15s)", kind: "video", aspect: "1:1", targetSeconds: 15, style: "Mysterious build-up, 3–4 quick beats, reveal the name and launch date at the end.", brief: "" },
  { id: "tutorial-vo", title: "Tutorial voiceover", kind: "voiceover", targetSeconds: 90, style: "Friendly instructor. Step-by-step, one action per segment, plain language.", brief: "" },
  { id: "podcast-3m", title: "2-host podcast episode (~3 min)", kind: "podcast", targetSeconds: 180, style: "Conversational and curious. One host explains, the other asks sharp questions and pushes back.", brief: "" },
];

const MODES: { value: JobKind; label: string; icon: typeof Film }[] = [
  { value: "video", label: "Video", icon: Clapperboard },
  { value: "voiceover", label: "Voiceover", icon: Mic },
  { value: "podcast", label: "Podcast", icon: Podcast },
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
  const [providersState, setProvidersState] = useState<"loading" | "ready" | "error">("loading");
  const [providersError, setProvidersError] = useState<unknown>(null);
  const [jobError, setJobError] = useState<unknown>(null);
  const loadProviders = useCallback(() => {
    setProvidersState("loading");
    api<MediaProvider[]>("/api/media-providers")
      .then((p) => {
        setMediaProviders(p);
        setProvidersState("ready");
      })
      .catch((e) => {
        setProvidersError(e);
        setProvidersState("error");
      });
  }, []);
  useEffect(() => {
    loadProviders();
  }, [loadProviders]);
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

  const reloadJob = useCallback(() => {
    if (!jobId) return;
    setJobError(null);
    loadJob(jobId, true).catch((e) => setJobError(e));
  }, [jobId, loadJob]);
  useEffect(() => {
    reloadJob();
  }, [reloadJob]);

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
  const produceHint = !plan ? "Draft or write a script first" : needsVoice && tts === "none" ? "Pick a voice provider first" : jobActive ? "A job is already running" : "Render the script to a media file";

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-editor">
      {/* ---------------- page header: title · mode · actions */}
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2">
        <h1 className="page-title shrink-0">Create studio</h1>
        <Segmented label="Format" value={mode} onChange={switchMode} options={MODES} />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {plan && (
            <button className="btn" onClick={saveScript} title="Save the script to the deliverables library">
              <Save size={13} /> Save script
            </button>
          )}
          {jobActive ? (
            <button className="btn" onClick={cancel}>
              <Square size={12} /> Cancel
            </button>
          ) : (
            <button className={`btn ${plan ? "btn-primary" : ""}`} onClick={produce} disabled={!canProduce} title={produceHint}>
              <Play size={13} /> {busy === "produce" ? "Starting…" : "Produce"}
            </button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @3xl:grid-cols-[300px_minmax(0,1fr)] @3xl:grid-rows-[minmax(0,1fr)] @3xl:overflow-hidden @5xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* ---------------- settings */}
        <aside aria-label="Settings" className="min-w-0 border-b border-line bg-side @3xl:overflow-y-auto @3xl:border-b-0 @3xl:border-r">
          <FieldGroup title="Script">
            <Field label="Preset" htmlFor="cs-preset">
              <select id="cs-preset" className="input" value={presetId} onChange={(e) => applyPreset(e.target.value)}>
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
            </Field>
            <Field label="Brief" htmlFor="cs-brief">
              <textarea
                id="cs-brief"
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
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {mode === "video" && (
                <Field label="Aspect ratio" htmlFor="cs-aspect">
                  <select id="cs-aspect" className="input" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
                    {ASPECTS.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </Field>
              )}
              <div className={mode === "video" ? "" : "col-span-2"}>
                <Field label="Length (seconds)" htmlFor="cs-length">
                  <input
                    id="cs-length"
                    className="input"
                    type="number"
                    min={5}
                    max={900}
                    step={5}
                    value={targetSeconds}
                    onChange={(e) => setTargetSeconds(Math.max(5, Math.min(900, Number(e.target.value) || 5)))}
                  />
                </Field>
              </div>
            </div>
            <Field label="Style" htmlFor="cs-style" help="Tone, pacing and voice the writer should follow.">
              <textarea id="cs-style" className="input" rows={2} placeholder="Calm, confident, short sentences…" value={style} onChange={(e) => setStyle(e.target.value)} />
            </Field>
            <Field label="Writer" help="The agent that drafts the script.">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <AgentPicker value={provider} onChange={setProvider} department={mode === "video" ? "video" : "content"} className="input" title="Agent that drafts the script" />
                </div>
                <button className={`btn shrink-0 ${plan ? "" : "btn-primary"}`} onClick={draft} disabled={!brief.trim() || busy !== null} title={brief.trim() ? "Draft a script from the brief" : "Write a brief first"}>
                  <Sparkles size={13} /> {busy === "script" ? "Drafting…" : plan ? "Redraft" : "Draft script"}
                </button>
              </div>
            </Field>
          </FieldGroup>

          <FieldGroup title="Production">
            {providersState === "loading" ? (
              <div className="space-y-3" aria-busy="true" aria-label="Loading voice and image providers">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <Skeleton className="mb-1.5 h-3 w-24" />
                    <Skeleton className="h-7 w-full" />
                  </div>
                ))}
              </div>
            ) : providersState === "error" ? (
              <ErrorState compact title="Couldn’t load voice and image providers" error={providersError} onRetry={loadProviders} />
            ) : (
              <>
                <Field label="Voice provider" htmlFor="cs-tts">
                  <select id="cs-tts" className="input" value={tts} onChange={(e) => setTts(e.target.value)}>
                    {mode === "video" && <option value="none">None (silent)</option>}
                    {ttsProviders.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>
                        {p.label}
                        {p.available ? "" : " (unavailable)"}
                      </option>
                    ))}
                  </select>
                  {selectedTts && !selectedTts.available && <p className="help !text-warn">{selectedTts.detail}</p>}
                  {needsVoice && tts === "none" && <p className="help !text-warn">Pick a voice provider to produce audio.</p>}
                </Field>
                {tts !== "none" && voices.length > 0 && (
                  <div className={mode === "podcast" ? "grid grid-cols-2 gap-2" : ""}>
                    <Field label={mode === "podcast" ? (plan as PodcastPlan | null)?.hosts?.[0] || "Host 1" : "Voice"} htmlFor="cs-voice">
                      <select id="cs-voice" className="input" value={voice} onChange={(e) => setVoice(e.target.value)}>
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {mode === "podcast" && (
                      <Field label={(plan as PodcastPlan | null)?.hosts?.[1] || "Host 2"} htmlFor="cs-voice2">
                        <select id="cs-voice2" className="input" value={voice2} onChange={(e) => setVoice2(e.target.value)}>
                          {voices.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </div>
                )}
                {mode === "video" && (
                  <Field label="Images" htmlFor="cs-image">
                    <select id="cs-image" className="input" value={image} onChange={(e) => setImage(e.target.value)}>
                      {imageProviders.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.available}>
                          {p.label}
                          {p.available ? "" : " (unavailable)"}
                        </option>
                      ))}
                    </select>
                    {selectedImage && <p className={`help ${selectedImage.available ? "" : "!text-warn"}`}>{selectedImage.detail}</p>}
                  </Field>
                )}
                <Field label={mode === "podcast" ? "Intro and outro music" : "Music bed"} htmlFor="cs-music">
                  <select id="cs-music" className="input" value={music} onChange={(e) => setMusic(e.target.value)}>
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
                </Field>
                {mode === "video" && (
                  <label className="flex items-start gap-2 text-[12.5px]">
                    <input type="checkbox" className="mt-0.5" checked={captions} disabled={tts === "none"} onChange={(e) => setCaptions(e.target.checked)} />
                    <span>
                      Burn in captions
                      <span className="help mt-0.5 block">Also saved as an SRT file. Needs a voice.</span>
                    </span>
                  </label>
                )}
              </>
            )}
          </FieldGroup>
        </aside>

        {/* ---------------- script + production */}
        <section aria-label="Script" className="flex min-h-[360px] min-w-0 flex-col @3xl:min-h-0">
          {plan && (
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-4">
              <label htmlFor="cs-title" className="sr-only">
                Title
              </label>
              <input
                id="cs-title"
                className="input input-sm min-w-0 max-w-[420px] flex-1 font-medium"
                value={plan.title}
                onChange={(e) => setPlan({ ...plan, title: e.target.value } as AnyPlan)}
              />
              <span className="shrink-0 text-[11px] tabular-nums text-muted" title={`Estimated at ${WORDS_PER_SEC} words per second`}>
                ≈ {fmtDur(total)} total
              </span>
            </div>
          )}

          {job && <JobStatusBar job={job} showLog={showLog} setShowLog={setShowLog} logRef={logRef} onOpenEditor={(file) => openTab({ kind: "video", file }, "Video editor")} onCopySrt={copySrt} />}

          <div className="min-h-0 flex-1 @3xl:overflow-y-auto">
            {jobError ? (
              <ErrorState title="Couldn’t load this production" error={jobError} onRetry={reloadJob} />
            ) : jobId && !job ? (
              <div className="mx-auto max-w-4xl space-y-3 p-4" aria-busy="true" aria-label="Loading">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-[132px] w-full" />
                <Skeleton className="h-[132px] w-full" />
              </div>
            ) : !plan ? (
              <div className="grid h-full place-items-center py-8">
                <EmptyState
                  icon={Sparkles}
                  title="No script yet"
                  hint="Write a brief and draft a script, or write one yourself. You can edit every line before producing."
                  secondary={{ label: "Write manually", onClick: () => setPlan(emptyPlan(mode)) }}
                />
              </div>
            ) : (
              <div className="p-4">
                {mode === "video" ? (
                  <VideoEditor plan={plan as VideoPlan} setPlan={setPlan} />
                ) : mode === "voiceover" ? (
                  <VoiceoverEditor plan={plan as VoiceoverPlan} setPlan={setPlan} />
                ) : (
                  <PodcastEditor plan={plan as PodcastPlan} setPlan={setPlan} />
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 pb-4 pt-3 last:border-b-0">
      <h2 className="section-title mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, help, children }: { label: string; htmlFor?: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="label truncate" htmlFor={htmlFor} title={label}>
        {label}
      </label>
      {children}
      {help && <p className="help">{help}</p>}
    </div>
  );
}

const STATUS_TONE: Record<MediaJob["status"], Tone> = { queued: "warn", running: "accent", done: "ok", error: "err", cancelled: "neutral" };
const STATUS_LABEL: Record<MediaJob["status"], string> = { queued: "Queued", running: "Producing", done: "Done", error: "Failed", cancelled: "Cancelled" };

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
  const pct = job.status === "done" ? 100 : job.progress;
  const detail = job.status === "error" ? job.error : job.step;
  return (
    <div className="shrink-0 border-b border-line bg-side">
      <div className="flex h-9 items-center gap-2 px-3">
        <button className="icon-btn" onClick={() => setShowLog(!showLog)} aria-label={showLog ? "Hide log" : "Show log"} aria-expanded={showLog} title={showLog ? "Hide log" : "Show log"}>
          {showLog ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Pill tone={STATUS_TONE[job.status] ?? "neutral"}>{STATUS_LABEL[job.status] ?? job.status}</Pill>
        <span className={`min-w-0 flex-1 truncate text-[12px] ${job.status === "error" ? "text-err" : "text-muted"}`} title={detail ?? undefined}>
          {detail}
        </span>
        <div className="h-1 w-24 shrink-0 overflow-hidden rounded-sm bg-elev @xl:w-40" role="progressbar" aria-label="Production progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className={`h-full ${color} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
        </div>
        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted">{pct}%</span>
      </div>
      {showLog && (
        <pre ref={logRef} className="mx-3 mb-2 max-h-48 overflow-auto rounded border border-line bg-editor p-2 font-mono text-[11px] leading-relaxed text-muted">
          {job.logs || "No log yet."}
        </pre>
      )}
      {job.status === "done" && job.output && (
        <div className="flex flex-col gap-3 border-t border-line px-3 py-3 @xl:flex-row @xl:items-start">
          {isVideo ? (
            <video key={src} src={src} controls className="max-h-[360px] min-w-0 max-w-full rounded-[6px] border border-line bg-bg" />
          ) : (
            <audio key={src} src={src} controls className="w-full max-w-md" />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <span className="truncate font-mono text-[11px] text-fg" title={job.output}>
              {job.output}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {isVideo && (
                <button className="btn btn-sm" onClick={() => onOpenEditor(job.output!)}>
                  <Film size={13} /> Open in video editor
                </button>
              )}
              <a className="btn btn-sm" href={`${src}?download=1`}>
                <Download size={13} /> Download
              </a>
              {job.srt && (
                <button className="btn btn-sm" onClick={onCopySrt}>
                  <Copy size={13} /> Copy SRT
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RowActions({ i, n, what, onMove, onRemove }: { i: number; n: number; what: string; onMove: (d: number) => void; onRemove: () => void }) {
  return (
    <>
      <button className="icon-btn" disabled={i === 0} onClick={() => onMove(-1)} aria-label={`Move ${what} up`} title="Move up">
        <ArrowUp size={13} />
      </button>
      <button className="icon-btn" disabled={i === n - 1} onClick={() => onMove(1)} aria-label={`Move ${what} down`} title="Move down">
        <ArrowDown size={13} />
      </button>
      <button className="icon-btn" disabled={n <= 1} onClick={onRemove} aria-label={`Remove ${what}`} title="Remove">
        <X size={13} />
      </button>
    </>
  );
}

function VideoEditor({ plan, setPlan }: { plan: VideoPlan; setPlan: (p: AnyPlan) => void }) {
  const setScene = (i: number, patch: Partial<Scene>) => setPlan({ ...plan, scenes: plan.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex max-w-sm items-center gap-2">
        <label className="label mb-0 shrink-0" htmlFor="cs-mood">
          Music mood
        </label>
        <input id="cs-mood" className="input input-sm" value={plan.musicMood} onChange={(e) => setPlan({ ...plan, musicMood: e.target.value })} />
      </div>
      {plan.scenes.map((s, i) => {
        const speech = estimateSpeechSec(s.narration);
        const over = speech + 0.5 > s.durationSec;
        return (
          <div key={i} className="card">
            <div className="flex h-9 items-center gap-2 border-b border-line pl-3 pr-1.5">
              <span className="text-[13px] font-semibold">Scene {i + 1}</span>
              <span className={`truncate text-[11px] ${over ? "text-warn" : "text-faint"}`} title="Narration is spoken at about 2.5 words per second; the scene stretches to fit it">
                ~{speech.toFixed(1)}s speech
              </span>
              <div className="flex-1" />
              <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
                Duration
                <input
                  className="input input-sm w-16"
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
                what={`scene ${i + 1}`}
                onMove={(d) => setPlan({ ...plan, scenes: move(plan.scenes, i, d) })}
                onRemove={() => setPlan({ ...plan, scenes: plan.scenes.filter((_, j) => j !== i) })}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 p-3 @xl:grid-cols-2">
              <label className="@xl:col-span-2">
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
      <button className="btn btn-sm" onClick={() => setPlan({ ...plan, scenes: [...plan.scenes, { ...EMPTY_SCENE }] })} disabled={plan.scenes.length >= 40}>
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
          <span className="w-6 shrink-0 pt-1.5 text-right text-[11px] tabular-nums text-faint">{i + 1}</span>
          <textarea
            className="input min-w-0 flex-1"
            rows={2}
            aria-label={`Segment ${i + 1}`}
            value={s.text}
            onChange={(e) => setPlan({ ...plan, segments: plan.segments.map((x, j) => (j === i ? { text: e.target.value } : x)) })}
          />
          <div className="flex shrink-0 flex-col items-center">
            <span className="text-[11px] tabular-nums text-faint">{estimateSpeechSec(s.text).toFixed(1)}s</span>
            <div className="flex">
              <RowActions
                i={i}
                n={plan.segments.length}
                what={`segment ${i + 1}`}
                onMove={(d) => setPlan({ ...plan, segments: move(plan.segments, i, d) })}
                onRemove={() => setPlan({ ...plan, segments: plan.segments.filter((_, j) => j !== i) })}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="btn btn-sm ml-8" onClick={() => setPlan({ ...plan, segments: [...plan.segments, { text: "" }] })}>
        <Plus size={13} /> Add segment
      </button>
    </div>
  );
}

function PodcastEditor({ plan, setPlan }: { plan: PodcastPlan; setPlan: (p: AnyPlan) => void }) {
  const setLine = (i: number, patch: Partial<PodcastPlan["lines"][number]>) => setPlan({ ...plan, lines: plan.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <div className="mb-3 grid grid-cols-1 gap-2 @xl:grid-cols-2">
        {[0, 1].map((h) => (
          <label key={h} className="flex min-w-0 items-center gap-2">
            <span className="label mb-0 shrink-0">Host {h + 1}</span>
            <input
              className="input input-sm"
              value={plan.hosts[h]}
              onChange={(e) => setPlan({ ...plan, hosts: (h === 0 ? [e.target.value, plan.hosts[1]] : [plan.hosts[0], e.target.value]) as [string, string] })}
            />
          </label>
        ))}
      </div>
      {plan.lines.map((l, i) => {
        const name = plan.hosts[l.speaker] || `Host ${l.speaker + 1}`;
        return (
          <div key={i} className="flex items-start gap-2">
            <button
              className={`btn btn-sm mt-0.5 w-24 shrink-0 justify-start ${l.speaker === 0 ? "text-accent" : "text-ok"}`}
              onClick={() => setLine(i, { speaker: l.speaker === 0 ? 1 : 0 })}
              aria-label={`Speaker: ${name}. Switch speaker`}
              title="Switch speaker"
            >
              <span className="truncate">{name}</span>
            </button>
            <textarea className="input min-w-0 flex-1" rows={2} aria-label={`Line ${i + 1}`} value={l.text} onChange={(e) => setLine(i, { text: e.target.value })} />
            <div className="flex shrink-0">
              <RowActions
                i={i}
                n={plan.lines.length}
                what={`line ${i + 1}`}
                onMove={(d) => setPlan({ ...plan, lines: move(plan.lines, i, d) })}
                onRemove={() => setPlan({ ...plan, lines: plan.lines.filter((_, j) => j !== i) })}
              />
            </div>
          </div>
        );
      })}
      <button
        className="btn btn-sm ml-[104px]"
        onClick={() => setPlan({ ...plan, lines: [...plan.lines, { speaker: plan.lines.length ? (plan.lines[plan.lines.length - 1].speaker === 0 ? 1 : 0) : 0, text: "" }] })}
      >
        <Plus size={13} /> Add line
      </button>
    </div>
  );
}
