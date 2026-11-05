#!/usr/bin/env node
// rex — command-line companion for the REX workbench.
//
// Talks to the running REX server (REX_URL, default http://localhost:4747).
// Inside REX's integrated terminal REX_URL and REX_PROJECT_ID are preset, and
// `rex` is on PATH. Elsewhere: `npm link` in the REX folder.
//
// Conversations started here are real agent sessions bound to REX's Agent
// panel: they show up in the panel's history and stay in sync.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.REX_URL || `http://localhost:${process.env.REX_PORT || 4747}`).replace(/\/$/, "");
// The local engine only accepts requests carrying its session secret (REX's terminals set REX_TOKEN).
const TOKEN =
  process.env.REX_TOKEN ||
  (() => {
    const dataDir = process.env.REX_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
    try {
      return fs.readFileSync(path.join(dataDir, ".session-secret"), "utf8").trim();
    } catch {
      return "";
    }
  })();
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c("2"), bold = c("1"), green = c("32"), red = c("31"), yellow = c("33"), cyan = c("36");

function die(msg, code = 1) {
  console.error(red(`rex: ${msg}`));
  process.exit(code);
}

async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { "content-type": "application/json", ...(TOKEN ? { "x-rex-token": TOKEN } : {}), ...(init.headers || {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    die(`can't reach REX at ${BASE}. Start it with \`npm run dev\` in the REX folder (or set REX_URL).`);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) die((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}

/** Parses `--flag value`, `--flag=value`, `-f value` and bare words. */
function parseArgs(argv, flags) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = a.match(/^--?([\w-]+)(?:=(.*))?$/);
    if (m && flags[m[1]]) {
      const key = flags[m[1]];
      opts[key] = m[2] ?? argv[++i];
    } else rest.push(a);
  }
  return { opts, rest };
}

async function currentProject(explicit) {
  const projects = await api("/api/projects");
  const want = explicit || process.env.REX_PROJECT_ID;
  if (want) {
    const p = projects.find((x) => x.id === want || x.name.toLowerCase() === String(want).toLowerCase());
    if (!p) die(`no project "${want}". Try \`rex projects\`.`);
    return p;
  }
  const cwd = process.cwd();
  return projects.find((p) => p.repo_path && (cwd === p.repo_path || cwd.startsWith(p.repo_path + "/"))) ?? projects[0] ?? null;
}

async function departments() {
  const c = await api("/api/plugins/contributions");
  return c.departments;
}

async function resolveDept(name) {
  const list = await departments();
  const q = String(name || "ceo").toLowerCase();
  const d = list.find((x) => x.id === q) ?? list.find((x) => x.name.toLowerCase() === q) ?? list.find((x) => x.name.toLowerCase().includes(q) || x.id.includes(q));
  if (!d) die(`no department "${name}". Try \`rex depts\`.`);
  return d;
}

const timeAgo = (ts) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// ---------------------------------------------------------------- commands

const HELP = `${bold("rex")} — REX workbench from the terminal ${dim(`(${BASE})`)}

${bold("Talk to departments")}
  rex chat [dept] [-a agent] [-m model]      open the department's agent interactively here (synced with the Agent panel)
  rex ask <dept> "message" [-a agent] [-m model] [--edits]
                                             one-shot: stream the answer, exit
  rex resume [dept]                          reopen the latest conversation of a department here

${bold("Plan & track")}
  rex tasks [--status todo|doing|review|done]   board tasks of the current project
  rex add "title" [-d dept] [--priority high]   add a board task
  rex plan "goal"                               AI plan → board tasks
  rex runs                                      recent agent runs

${bold("Workspace")}
  rex projects        rex depts        rex agents        rex open

Options: -p/--project <name|id> (default: the project whose repo contains this folder, or REX_PROJECT_ID)`;

const commands = {
  async help() {
    console.log(HELP);
  },

  async agents() {
    const list = await api("/api/agents");
    for (const a of list) {
      console.log(`${a.available ? green("●") : red("●")} ${bold(a.label.padEnd(16))} ${dim(a.id.padEnd(14))} ${a.available ? dim(a.detail) : yellow(a.install ? `not installed — ${a.install}` : "not installed")}`);
    }
  },

  async depts() {
    const [list, prefs] = await Promise.all([departments(), api("/api/agents/prefs")]);
    for (const d of list) console.log(`${bold(d.id.padEnd(12))} ${d.name.padEnd(20)} ${dim(d.role)} ${cyan(prefs.departments[d.id] || d.defaultProvider)}`);
  },

  async projects() {
    const list = await api("/api/projects");
    const cur = await currentProject();
    for (const p of list) console.log(`${p.id === cur?.id ? green("›") : " "} ${bold(p.name.padEnd(24))} ${dim(p.stage.padEnd(9))} ${dim(p.repo_path || "no repo")}`);
  },

  async open() {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [BASE], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    console.log(BASE);
  },

  async tasks(argv) {
    const { opts } = parseArgs(argv, { p: "project", project: "project", status: "status", s: "status" });
    const project = await currentProject(opts.project);
    if (!project) die("no project yet — create one in REX");
    const tasks = (await api(`/api/tasks?projectId=${project.id}`)).filter((t) => (opts.status ? t.status === opts.status : t.status !== "done"));
    const color = { urgent: red, high: yellow, medium: (s) => s, low: dim };
    console.log(dim(`${project.name} · ${tasks.length} task${tasks.length === 1 ? "" : "s"}`));
    for (const t of tasks) console.log(`${dim(`[${t.status}]`.padEnd(10))} ${color[t.priority](t.priority.padEnd(7))} ${cyan(t.department.padEnd(12))} ${t.title}`);
  },

  async add(argv) {
    const { opts, rest } = parseArgs(argv, { p: "project", project: "project", d: "dept", dept: "dept", priority: "priority" });
    const title = rest.join(" ").trim();
    if (!title) die('usage: rex add "title" [-d dept] [--priority high]');
    const project = await currentProject(opts.project);
    if (!project) die("no project yet — create one in REX");
    const dept = opts.dept ? (await resolveDept(opts.dept)).id : undefined;
    await api("/api/tasks", { method: "POST", json: { projectId: project.id, tasks: [{ title, department: dept, priority: opts.priority, status: "todo" }] } });
    console.log(green("✓"), `added to ${project.name}: ${title}`);
  },

  async plan(argv) {
    const { opts, rest } = parseArgs(argv, { p: "project", project: "project", a: "agent", agent: "agent" });
    const goal = rest.join(" ").trim();
    if (!goal) die('usage: rex plan "goal"');
    const project = await currentProject(opts.project);
    if (!project) die("no project yet — create one in REX");
    process.stderr.write(dim(`Planning with the Chief of Staff for ${project.name}…\n`));
    const tasks = await api("/api/plan", { method: "POST", json: { projectId: project.id, goal, provider: opts.agent ?? null } });
    for (const t of tasks) console.log(`${green("+")} ${cyan(t.department.padEnd(12))} ${t.title}`);
    console.log(dim(`${tasks.length} tasks added to the board`));
  },

  async runs(argv) {
    const { opts } = parseArgs(argv, { n: "limit", limit: "limit" });
    const runs = await api(`/api/runs?limit=${Number(opts.limit) || 15}`);
    const mark = { running: cyan("◐"), done: green("✓"), error: red("✗"), cancelled: dim("–") };
    for (const r of runs) console.log(`${mark[r.status] ?? "?"} ${dim(timeAgo(r.created_at).padEnd(8))} ${cyan(r.department.padEnd(12))} ${dim(r.provider.padEnd(12))} ${r.brief.replace(/\s+/g, " ").slice(0, 80)}`);
  },

  async ask(argv) {
    const { opts, rest } = parseArgs(argv, { a: "agent", agent: "agent", m: "model", model: "model", p: "project", project: "project" });
    const edits = rest.includes("--edits");
    const words = rest.filter((w) => w !== "--edits");
    if (words.length < 2) die('usage: rex ask <dept> "message"');
    const dept = await resolveDept(words[0]);
    let brief = words.slice(1).join(" ");
    if (!process.stdin.isTTY) {
      // `cat file | rex ask engineering "review this"` → piped text becomes context.
      let piped = "";
      for await (const chunk of process.stdin) piped += chunk;
      if (piped.trim()) brief = `${brief}\n\n\`\`\`\n${piped}\n\`\`\``;
    }
    const project = await currentProject(opts.project);
    const run = await api("/api/runs", {
      method: "POST",
      json: { department: dept.id, provider: opts.agent ?? null, model: opts.model ?? null, brief, projectId: project?.id ?? null, allowEdits: edits },
    });
    process.stderr.write(dim(`${dept.name} · ${run.provider}${project ? ` · ${project.name}` : ""}\n`));
    const res = await fetch(`${BASE}/api/runs/${run.id}/stream`, { headers: TOKEN ? { "x-rex-token": TOKEN } : {} }).catch(() => die("lost connection to REX"));
    const decoder = new TextDecoder();
    let buf = "";
    let status = "running";
    let error = null;
    process.on("SIGINT", async () => {
      await api(`/api/runs/${run.id}/cancel`, { method: "POST" }).catch(() => {});
      process.stderr.write(yellow("\ncancelled\n"));
      process.exit(130);
    });
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "snapshot") {
          if (ev.output) process.stdout.write(ev.output);
          status = ev.status;
          error = ev.error;
        } else if (ev.type === "chunk") process.stdout.write(ev.text);
        else if (ev.type === "status") {
          status = ev.status;
          error = ev.error;
        }
      }
      if (status !== "running") break;
    }
    process.stdout.write("\n");
    if (status === "error") die(error || "run failed");
    if (status === "cancelled") process.exit(130);
  },

  async chat(argv, resumeLatest = false) {
    const { opts, rest } = parseArgs(argv, { a: "agent", agent: "agent", m: "model", model: "model", p: "project", project: "project", t: "thread", thread: "thread" });
    const dept = await resolveDept(rest[0]);
    const project = await currentProject(opts.project);
    let threadId = opts.thread ?? null;
    if (resumeLatest && !threadId) {
      const qs = new URLSearchParams({ department: dept.id, ...(project ? { projectId: project.id } : {}) });
      threadId = (await api(`/api/threads?${qs}`))[0]?.thread_id ?? null;
      if (!threadId) process.stderr.write(dim("No earlier conversation — starting a new one.\n"));
    }
    const l = await api("/api/agents/launch", {
      method: "POST",
      json: { department: dept.id, agent: opts.agent ?? null, model: opts.model ?? null, projectId: project?.id ?? null, threadId },
    });
    process.stderr.write(dim(`${l.departmentName} · ${l.agent} · ${l.cwd}\nThis conversation is synced with REX's Agent panel.\n`));
    const child = spawn(process.env.SHELL || "/bin/sh", ["-c", l.command], { cwd: l.cwd, stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
  },

  async resume(argv) {
    return commands.chat(argv, true);
  },
};

const [cmd = "help", ...argv] = process.argv.slice(2);
const aliases = { "-h": "help", "--help": "help", ls: "tasks", departments: "depts", project: "projects", "?": "help" };
const fn = commands[aliases[cmd] ?? cmd];
if (!fn) die(`unknown command "${cmd}". Run \`rex help\`.`);
await fn(argv);
