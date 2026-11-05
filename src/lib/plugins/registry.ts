import "server-only";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { DATA_DIR } from "../db";
import { DEPARTMENTS, type Department } from "../departments";
import { registerImage, registerTts, unregisterSource } from "../media/providers";
import { getSetting, setSetting } from "../repo";
import {
  PluginManifest,
  type AgentContribution,
  type ConnectionContribution,
  type ThemeContribution,
  type CatalogEntry,
  type CommandContribution,
  type InstalledPlugin,
  type PipelineContribution,
} from "./types";

const execFileAsync = promisify(execFile);

export const PLUGINS_DIR = path.join(DATA_DIR, "plugins");
/** First-party catalog shipped with REX. */
export const CATALOG_DIR = path.join(process.cwd(), "marketplace", "plugins");
/** REX's bundled tools (bin/rex.mjs, bin/rex-google-mcp.mjs), for `${rex:bin}` in extension manifests. */
export const REX_BIN = path.join(process.cwd(), "bin");
const MANIFEST = "rex-plugin.json";
const STATE_KEY = "plugins:state";
const REGISTRIES_KEY = "plugins:registries";

interface PluginState {
  enabled: boolean;
  trusted: boolean;
  source: string;
  installedAt: number;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

function readState(): Record<string, PluginState> {
  try {
    return JSON.parse(getSetting(STATE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeState(s: Record<string, PluginState>) {
  setSetting(STATE_KEY, JSON.stringify(s));
}

function settingKey(pluginId: string, key: string) {
  return `plugin:${pluginId}:${key}`;
}

export function getPluginSetting(pluginId: string, key: string): string | undefined {
  return getSetting(settingKey(pluginId, key)) || undefined;
}

export function setPluginSetting(pluginId: string, key: string, value: string) {
  const manifest = readManifest(path.join(PLUGINS_DIR, pluginId));
  if (!manifest.contributes.settings.some((s) => s.key === key)) throw new Error(`Unknown setting ${key} for ${pluginId}`);
  setSetting(settingKey(pluginId, key), value);
}

// ---------------------------------------------------------------------------
// manifests
// ---------------------------------------------------------------------------

function readManifest(dir: string): PluginManifest {
  const file = path.join(/*turbopackIgnore: true*/ dir, MANIFEST);
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) throw new Error(`No ${MANIFEST} in ${dir}`);
  return PluginManifest.parse(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")));
}

/** Manifests of the built-in catalog (marketplace/plugins), for showing what an uninstalled extension offers. */
export function catalogManifests(): { manifest: PluginManifest; source: string }[] {
  if (!fs.existsSync(/*turbopackIgnore: true*/ CATALOG_DIR)) return [];
  const out: { manifest: PluginManifest; source: string }[] = [];
  for (const dir of fs.readdirSync(/*turbopackIgnore: true*/ CATALOG_DIR)) {
    try {
      out.push({ manifest: readManifest(path.join(CATALOG_DIR, dir)), source: `builtin:${dir}` });
    } catch {
      /* broken entry */
    }
  }
  return out;
}

export function listInstalled(): InstalledPlugin[] {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  const state = readState();
  const out: InstalledPlugin[] = [];
  for (const name of fs.readdirSync(/*turbopackIgnore: true*/ PLUGINS_DIR)) {
    const dir = path.join(PLUGINS_DIR, name);
    if (!fs.statSync(/*turbopackIgnore: true*/ dir).isDirectory()) continue;
    const st = state[name] ?? { enabled: true, trusted: false, source: "local", installedAt: 0 };
    try {
      const manifest = readManifest(dir);
      out.push({
        manifest,
        enabled: st.enabled,
        trusted: st.trusted,
        hasCode: Boolean(manifest.main),
        source: st.source,
        installedAt: st.installedAt,
        error: activationErrors.get(manifest.id),
        configured: manifest.contributes.settings.filter((s) => getPluginSetting(manifest.id, s.key)).map((s) => s.key),
      });
    } catch (e) {
      out.push({
        manifest: { id: name, name, version: "?", description: "", author: "", icon: "Puzzle", categories: [], contributes: { departments: [], commands: [], mcpServers: {}, settings: [], pipelines: [], agents: [], connections: [], themes: [] } },
        enabled: false,
        trusted: false,
        hasCode: false,
        source: st.source,
        installedAt: st.installedAt,
        error: `Invalid manifest: ${e instanceof Error ? e.message : String(e)}`,
        configured: [],
      });
    }
  }
  return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

function enabledPlugins(): InstalledPlugin[] {
  return listInstalled().filter((p) => p.enabled && !p.error?.startsWith("Invalid manifest"));
}

// ---------------------------------------------------------------------------
// contributions
// ---------------------------------------------------------------------------

export type ResolvedDepartment = Department & { pluginId?: string };

export function allDepartments(): ResolvedDepartment[] {
  const builtinIds = new Set(DEPARTMENTS.map((d) => d.id));
  const extra: ResolvedDepartment[] = [];
  for (const p of enabledPlugins()) {
    for (const d of p.manifest.contributes.departments) {
      if (builtinIds.has(d.id) || extra.some((x) => x.id === d.id)) continue;
      extra.push({ ...d, pluginId: p.manifest.id });
    }
  }
  return [...DEPARTMENTS, ...extra];
}

export function resolveDepartment(id: string): ResolvedDepartment {
  const all = allDepartments();
  return all.find((d) => d.id === id) ?? all[0];
}

export function allCommands(): (CommandContribution & { pluginId: string })[] {
  return enabledPlugins().flatMap((p) => p.manifest.contributes.commands.map((c) => ({ ...c, pluginId: p.manifest.id })));
}

export function allPipelines(): (PipelineContribution & { pluginId: string })[] {
  return enabledPlugins().flatMap((p) => p.manifest.contributes.pipelines.map((c) => ({ ...c, pluginId: p.manifest.id })));
}

export function allAgentContributions(): (AgentContribution & { pluginId: string })[] {
  return enabledPlugins().flatMap((p) => p.manifest.contributes.agents.map((a) => ({ ...a, pluginId: p.manifest.id })));
}

export interface ResolvedMcpServer {
  name: string;
  pluginId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  transport?: "stdio" | "http" | "sse";
  departments?: string[];
  /** Settings referenced in env that are still empty. */
  missing: string[];
}

/** MCP servers from enabled plugins, with ${setting:KEY} resolved from plugin settings. */
export function allMcpServers(): ResolvedMcpServer[] {
  const out: ResolvedMcpServer[] = [];
  for (const p of enabledPlugins()) {
    for (const [name, srv] of Object.entries(p.manifest.contributes.mcpServers)) {
      const missing: string[] = [];
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(srv.env)) {
        env[k] = v.replace(/\$\{setting:([A-Za-z0-9_]+)\}/g, (_, key: string) => {
          const val = getPluginSetting(p.manifest.id, key);
          if (!val) missing.push(key);
          return val ?? "";
        });
      }
      const rex = (v: string) => v.replaceAll("${rex:bin}", REX_BIN);
      out.push({ name, pluginId: p.manifest.id, command: rex(srv.command), args: srv.args.map(rex), env, missing, url: srv.url, transport: srv.transport, departments: srv.departments });
    }
  }
  return out;
}

/**
 * MCP servers that are fully configured and can be handed to CLI agents. With
 * a department, servers scoped to other departments are left out, so e.g. a
 * design run doesn't spawn the analytics servers.
 */
export function readyMcpServers(department?: string): ResolvedMcpServer[] {
  return allMcpServers().filter((s) => s.missing.length === 0 && (!department || !s.departments?.length || s.departments.includes(department)));
}

export function allThemes(): (ThemeContribution & { pluginId: string })[] {
  return enabledPlugins().flatMap((p) => p.manifest.contributes.themes.map((t) => ({ ...t, pluginId: p.manifest.id })));
}

export function allConnectionContributions(): (ConnectionContribution & { pluginId: string })[] {
  return enabledPlugins().flatMap((p) => p.manifest.contributes.connections.map((c) => ({ ...c, pluginId: p.manifest.id })));
}

// ---------------------------------------------------------------------------
// install / uninstall / toggle
// ---------------------------------------------------------------------------

function copyDir(src: string, dest: string) {
  fs.cpSync(/*turbopackIgnore: true*/ src, dest, {
    recursive: true,
    filter: (s) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(s.slice(src.length)),
  });
}

function placeInstalled(stagingDir: string, source: string): PluginManifest {
  const manifest = readManifest(stagingDir);
  const dest = path.join(PLUGINS_DIR, manifest.id);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(stagingDir, dest);
  const state = readState();
  const prev = state[manifest.id];
  // Updating keeps the user's choices, except trust: new code must be re-trusted.
  state[manifest.id] = { enabled: prev?.enabled ?? true, trusted: false, source, installedAt: Date.now() };
  writeState(state);
  resetPluginCode();
  return manifest;
}

const GIT_URL = /^(https:\/\/[\w.-]+\/[\w./-]+?(\.git)?|git@[\w.-]+:[\w./-]+?(\.git)?)$/;

export async function installPlugin(source: string): Promise<PluginManifest> {
  if (source.startsWith("builtin:")) {
    const dir = path.join(CATALOG_DIR, path.basename(source.slice("builtin:".length)));
    return placeInstalled(dir, source);
  }
  if (GIT_URL.test(source)) {
    const tmp = path.join(os.tmpdir(), `rex-plugin-${randomUUID()}`);
    try {
      await execFileAsync("git", ["clone", "--depth", "1", "--", source, tmp], { timeout: 120_000 });
      return placeInstalled(tmp, source);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (path.isAbsolute(source) && fs.existsSync(/*turbopackIgnore: true*/ source)) {
    return placeInstalled(source, `local:${source}`);
  }
  throw new Error("Source must be a catalog id, an https/ssh git URL, or an absolute folder path");
}

export function uninstallPlugin(id: string) {
  const dir = path.join(PLUGINS_DIR, path.basename(id));
  fs.rmSync(dir, { recursive: true, force: true });
  const state = readState();
  delete state[id];
  writeState(state);
  resetPluginCode();
}

export function updatePluginState(id: string, patch: { enabled?: boolean; trusted?: boolean }) {
  const state = readState();
  const cur = state[id] ?? { enabled: true, trusted: false, source: "local", installedAt: Date.now() };
  state[id] = { ...cur, ...patch };
  writeState(state);
  resetPluginCode();
}

// ---------------------------------------------------------------------------
// marketplace catalog
// ---------------------------------------------------------------------------

export function getRegistries(): string[] {
  try {
    return JSON.parse(getSetting(REGISTRIES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function setRegistries(urls: string[]) {
  setSetting(REGISTRIES_KEY, JSON.stringify(urls.filter((u) => /^https:\/\//.test(u))));
}

export async function catalog(): Promise<CatalogEntry[]> {
  const installed = new Set(listInstalled().map((p) => p.manifest.id));
  const entries: CatalogEntry[] = [];
  if (fs.existsSync(CATALOG_DIR)) {
    for (const dir of fs.readdirSync(CATALOG_DIR)) {
      try {
        const m = readManifest(path.join(CATALOG_DIR, dir));
        entries.push({
          id: m.id,
          name: m.name,
          description: m.description,
          author: m.author,
          version: m.version,
          icon: m.icon,
          categories: m.categories,
          hasCode: Boolean(m.main),
          source: `builtin:${dir}`,
          registry: "REX",
        });
      } catch {
        /* skip broken catalog entries */
      }
    }
  }
  // Remote registries: JSON { plugins: CatalogEntry[] } where source is a git URL.
  await Promise.all(
    getRegistries().map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const data = (await res.json()) as { plugins?: Partial<CatalogEntry>[] };
        for (const e of data.plugins ?? []) {
          if (!e.id || !e.name || !e.source || !GIT_URL.test(e.source)) continue;
          entries.push({
            id: e.id,
            name: e.name,
            description: e.description ?? "",
            author: e.author ?? "",
            version: e.version ?? "",
            icon: e.icon ?? "Puzzle",
            categories: e.categories ?? [],
            hasCode: Boolean(e.hasCode),
            source: e.source,
            registry: new URL(url).hostname,
          });
        }
      } catch {
        /* unreachable registry: skip */
      }
    }),
  );
  return entries.map((e) => ({ ...e, installed: installed.has(e.id) }));
}

// ---------------------------------------------------------------------------
// code plugins (media providers)
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __rexPluginCode?: Set<string>; __rexPluginErrors?: Map<string, string> };
const activated: Set<string> = (g.__rexPluginCode ??= new Set());
const activationErrors: Map<string, string> = (g.__rexPluginErrors ??= new Map());

/** Drop all plugin-registered providers; they re-activate lazily on next provider lookup. */
function resetPluginCode() {
  for (const id of activated) unregisterSource(id);
  activated.clear();
  activationErrors.clear();
}

/** Runs `activate(api)` for every enabled + trusted code plugin not yet activated. */
export async function activatePluginCode(): Promise<void> {
  for (const p of enabledPlugins()) {
    const id = p.manifest.id;
    if (!p.manifest.main || !p.trusted || activated.has(id)) continue;
    activated.add(id);
    try {
      const dir = path.join(PLUGINS_DIR, id);
      const entry = path.resolve(dir, p.manifest.main);
      if (!entry.startsWith(dir + path.sep)) throw new Error("main must be inside the plugin folder");
      const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${pathToFileURL(entry).href}?v=${p.installedAt}`)) as {
        activate?: (api: unknown) => unknown;
      };
      if (typeof mod.activate !== "function") throw new Error("main does not export activate(api)");
      await mod.activate({
        pluginId: id,
        registerTts: (prov: Parameters<typeof registerTts>[0]) => registerTts(prov, id),
        registerImage: (prov: Parameters<typeof registerImage>[0]) => registerImage(prov, id),
        getSetting: (key: string) => getPluginSetting(id, key),
        log: (msg: string) => console.log(`[plugin ${id}] ${msg}`),
      });
    } catch (e) {
      activationErrors.set(id, e instanceof Error ? e.message : String(e));
    }
  }
}
