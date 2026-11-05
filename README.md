# REX: one-person company workbench

A VS Code–style workbench where you run a company as CEO and every department is an AI agent:
planning → engineering → QA/DevOps → marketing → SEO/AEO → content → graphics → video.

## Run

```bash
npm install
npm run dev                  # http://localhost:4747
```

Requirements: Node 22+, `ffmpeg`/`ffprobe` on PATH (Video Studio), and at least one terminal AI agent CLI.

**No API keys.** Every department runs on a terminal agent that uses its own login:
Claude Code (`claude`) and Codex (`codex`) are built in; Cursor Agent, Gemini CLI, Qwen Code, Ollama (local models),
OpenCode and GitHub Copilot CLI come from Extensions. Install / sign in from **Settings → Agents**: REX types the
CLI's own install or login command into the integrated terminal.

## Desktop app

REX ships as an Electron app (`desktop/`): it bundles the Next.js standalone server and runs it
with Electron's own Node, so customers don't need Node installed.

```bash
npm run desktop:dev          # Electron against `next dev` (reuses :4747 if already running; uses ./data)
npm run desktop:build        # next build → desktop/stage/server → electron-builder → dist/
npm run desktop:build:dir    # same, unpacked app only (faster, for testing)
npm run desktop:icons        # regenerate desktop/build/icon.{icns,ico,png} from icon*.svg
```

- Outputs (in `dist/`): macOS `.dmg` + `.zip`, Windows NSIS installer, Linux AppImage. Builds the host OS and
  arch; `REX_DESKTOP_ARCH=all npm run desktop:build` adds the other arch (arm64 + x64). Run it on each OS (or CI).
- User data lives in the OS app-data folder (`~/Library/Application Support/REX/data` on macOS,
  `%APPDATA%\REX\data` on Windows): `REX_DATA_DIR` points the engine there. Engine log: `…/REX/logs/server.log`.
- The engine listens on `127.0.0.1` with a stable per-install port and a fresh `REX_SESSION_SECRET` per launch.
  It inherits your login-shell `PATH`, so `claude`, `codex`, `gh`, `git`, `ffmpeg` are found like in Terminal.
- Native modules (better-sqlite3, node-pty, resvg) are N-API prebuilds; `desktop:build` checks them under
  Electron's ABI and never touches the root `node_modules` (plain `npm run dev` keeps working).
- Signing (optional; unsigned/ad-hoc builds work locally):
  - macOS: `CSC_LINK` (Developer ID Application .p12, path or base64) + `CSC_KEY_PASSWORD`, or `CSC_NAME`
    for a keychain identity. Notarization runs when `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`
    (or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`) are set.
  - Windows: `CSC_LINK` + `CSC_KEY_PASSWORD` (or `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`).

## Layout

| Area | What it does |
|---|---|
| Activity bar | Command Center, Plan & Board, Code Explorer, Deliverables, SEO & AEO, Graphics, Video, Agent Runs, Settings |
| Editor tabs | Dashboard, Kanban boards, Monaco code editor, deliverables, run transcripts, studios |
| Agent panel (⌘L) | Chat with any department on any terminal agent + model; history; open the agent interactively in the terminal as that department; save output, turn it into board tasks |
| Output panel (⌘J) | Activity log for runs, plans, audits, renders |
| ⌘K / ⌘P | Command palette / quick-open file |
| ⌘⇧F · ⌘⇧G · ⌘⇧X · ⌃` | Find in files · Source Control · Extensions · Terminal |
| Create Studio | Brief → AI script → scene visuals → voiceover → music → captions → MP4; voiceover and 2-host podcast MP3s |

## `rex` CLI

`bin/rex.mjs` is on PATH inside REX's integrated terminal (elsewhere: `npm link` in this folder). It talks to the running server.

```bash
rex chat marketing            # the department's agent, interactive, right here (synced with the Agent panel)
rex resume engineering        # reopen that department's latest conversation
rex ask seo "audit our homepage title tags"      # one-shot, streams the answer; pipe files in as context
rex plan "launch v1 with landing page + SEO"     # AI plan → board tasks
rex tasks · rex add "Write pricing page" -d content · rex runs · rex agents · rex depts · rex projects · rex open
```

## Panel ⇄ terminal sync

Each Agent-panel conversation is bound to the agent's own session (Claude Code `--session-id`/`--resume`,
Codex `exec resume`). Panel turns resume it headlessly; **Terminal** view / "Open in terminal" / `rex chat`
open the same session interactively; while it's open, panel messages are typed into it. The panel renders the
session transcript, so anything done in the terminal appears in the chat.

## Connections (third-party tools)

Mission rail → **Connections** (or ⌘K "Connections"). Each connection is an extension, scoped to the departments it serves:

| Area | Connections | How it connects |
|---|---|---|
| Analytics / SEO | Google Analytics (GA4), Google Search Console | MCP servers; sign in with `gcloud auth application-default login` in the terminal / service-account file |
| Design | Figma, Canva | Official remote MCP servers; **Connect** opens Claude Code `/mcp` for the provider's OAuth |
| Video / motion | Premiere Pro, After Effects, DaVinci Resolve, Final Cut Pro, CapCut | Desktop apps: **Open in…** on any video; Premiere/Resolve get an FCP7 XML timeline with scene markers, After Effects a script that builds the comp |
| Images | Photoshop, Illustrator | Open REX graphics in the app |
| Docs / dev / revenue | Notion, Linear, Sentry, Vercel, Supabase, Stripe, GitHub, Browser automation | MCP (remote OAuth or token) |

MCP servers can be `command`-based (stdio) or remote (`url`), and can be scoped with `departments` so a run only gets the tools for its department.

## Extensions

An extension is a folder with `rex-plugin.json` (schema: `src/lib/plugins/types.ts`). It can contribute:

- `agents`: terminal AI agent CLIs (command, args, read-only/edit flags, models, output format `text` / `claude-stream-json` / `cursor-stream-json` / `gemini-stream-json` / `codex-json`, install + login commands, interactive mode)
- `departments`: new AI departments (persona, default agent, quick actions)
- `commands`: ⌘K palette entries that delegate a prompt to a department
- `mcpServers`: MCP tool servers (stdio `command` or remote `url`, optional `departments` scope) handed to Claude Code (`--mcp-config`) and Codex (`-c mcp_servers.*`); env may use `${setting:KEY}`
- `themes`: color themes (`kind` dark/light + workbench color tokens) — pick with Preferences ▸ Color Theme
- `connections`: third-party connections for the Connections hub (`kind: mcp|app`, `auth: agent-oauth|terminal|settings|none`, app detection + actions)
- `settings`: write-only values (tokens for MCP servers) stored locally
- `pipelines`: Create Studio presets
- `main`: optional ESM `activate(api)` that registers voice/image providers. **Runs only after you click "Trust".**

Install from the built-in catalog (`marketplace/plugins/`), a git URL, an absolute folder, or remote registries (Settings → Extension marketplaces).

## Architecture

- `src/lib/departments.ts`: departments (persona, default agent, quick actions)
- `src/lib/ai/agents.ts`: agent registry (built-in + extension), availability probe, per-department preferences, terminal launch lines
- `src/lib/ai/providers.ts`: runners: `claude -p` stream-json (+MCP), `codex exec --json` (+MCP), and a generic declarative runner for extension agents
- `src/lib/runs.ts`: background run engine; runs survive tab switches; SSE at `/api/runs/:id/stream`
- `src/lib/seo.ts`: technical SEO + AEO auditor (JSON-LD, FAQ, llms.txt, AI-crawler access)
- `src/lib/video.ts`: closed set of validated ffmpeg ops (no raw commands from users or AI)
- `src/lib/db.ts`: SQLite (better-sqlite3) with append-only migrations; data lives in `./data`

Engineering and QA agents run inside the project's repo folder, **read-only unless “edits” is ticked**.
