import "server-only";

/**
 * Media generation provider registry.
 *
 * Built-in providers live in ./builtins.ts. Plugins with code (`main`) register
 * additional providers through the API passed to their `activate(api)` export.
 * Every provider writes its result to `outPath`, a file the pipeline owns.
 */

export interface Availability {
  ok: boolean;
  detail: string;
}

export interface Voice {
  id: string;
  label: string;
}

export interface TtsProvider {
  id: string;
  label: string;
  /** Output container the provider writes, e.g. "aiff", "mp3", "wav". */
  format: string;
  available(): Promise<Availability>;
  voices(): Promise<Voice[]>;
  synthesize(input: { text: string; voice?: string; outPath: string; signal?: AbortSignal }): Promise<void>;
}

export interface ImageProvider {
  id: string;
  label: string;
  available(): Promise<Availability>;
  /** Must write a PNG at exactly width×height (or close; the pipeline scales/crops). */
  generate(input: { prompt: string; width: number; height: number; outPath: string; signal?: AbortSignal }): Promise<void>;
}

export interface ProviderInfo {
  id: string;
  label: string;
  kind: "tts" | "image";
  source: string; // "builtin" | plugin id
  available: boolean;
  detail: string;
  voices?: Voice[];
}

interface Registered<T> {
  provider: T;
  source: string;
}

const g = globalThis as unknown as {
  __rexTts?: Map<string, Registered<TtsProvider>>;
  __rexImg?: Map<string, Registered<ImageProvider>>;
};
const tts: Map<string, Registered<TtsProvider>> = (g.__rexTts ??= new Map());
const img: Map<string, Registered<ImageProvider>> = (g.__rexImg ??= new Map());

export function registerTts(provider: TtsProvider, source = "builtin") {
  tts.set(provider.id, { provider, source });
}

export function registerImage(provider: ImageProvider, source = "builtin") {
  img.set(provider.id, { provider, source });
}

/** Remove everything a plugin registered (on disable/uninstall/reload). */
export function unregisterSource(source: string) {
  for (const [k, v] of tts) if (v.source === source) tts.delete(k);
  for (const [k, v] of img) if (v.source === source) img.delete(k);
}

let builtinsLoaded = false;
async function ensureBuiltins() {
  if (!builtinsLoaded) {
    builtinsLoaded = true;
    const { registerBuiltinProviders } = await import("./builtins");
    registerBuiltinProviders();
  }
  // Idempotent: activates newly trusted/enabled code plugins (and re-activates after a reset).
  const { activatePluginCode } = await import("../plugins/registry");
  await activatePluginCode();
}

export async function getTts(id: string): Promise<TtsProvider> {
  await ensureBuiltins();
  const p = tts.get(id)?.provider;
  if (!p) throw new Error(`Unknown voice provider: ${id}`);
  return p;
}

export async function getImage(id: string): Promise<ImageProvider> {
  await ensureBuiltins();
  const p = img.get(id)?.provider;
  if (!p) throw new Error(`Unknown image provider: ${id}`);
  return p;
}

export async function listProviders(): Promise<ProviderInfo[]> {
  await ensureBuiltins();
  const out: ProviderInfo[] = [];
  for (const { provider, source } of tts.values()) {
    const a = await provider.available().catch((e) => ({ ok: false, detail: String(e) }));
    out.push({ id: provider.id, label: provider.label, kind: "tts", source, available: a.ok, detail: a.detail, voices: a.ok ? await provider.voices().catch(() => []) : [] });
  }
  for (const { provider, source } of img.values()) {
    const a = await provider.available().catch((e) => ({ ok: false, detail: String(e) }));
    out.push({ id: provider.id, label: provider.label, kind: "image", source, available: a.ok, detail: a.detail });
  }
  return out;
}
