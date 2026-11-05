import type { DeliverableKind, ProviderId } from "./types";

/**
 * AI "departments" — each is an agent persona you, the CEO, delegate to.
 * Client-safe: imported by both the agent panel and the run engine.
 */
export interface Department {
  id: string;
  name: string;
  role: string;
  /** lucide-react icon name, resolved in components/icons.tsx */
  icon: string;
  color: string;
  defaultProvider: ProviderId;
  /** Coding departments run CLI agents inside the project repo. */
  usesRepo: boolean;
  outputKind: DeliverableKind;
  system: string;
  quickActions: { label: string; prompt: string }[];
}

const OPERATING_RULES = `
You work for a one-person company. The founder is the CEO and a senior software engineer; you are their department head.
- Be decisive and concrete. Produce finished, usable work — not outlines of work.
- No filler, no disclaimers, no "as an AI". Calibrate to an expert reader.
- Use Markdown with clear headings. Use tables for comparisons and checklists for action items.
- When you recommend actions, end with a "Next actions" checklist (- [ ] item — owner department).
- If project context is provided, ground every answer in it.`;

export const DEPARTMENTS: Department[] = [
  {
    id: "ceo",
    name: "Chief of Staff",
    role: "Strategy, prioritization, weekly planning, decisions",
    icon: "Crown",
    color: "#e5c07b",
    defaultProvider: "claude-cli",
    usesRepo: false,
    outputKind: "markdown",
    system: `You are the Chief of Staff to a solo founder-CEO. You turn ambitions into focused plans, force-rank priorities, write decision memos, and run the weekly operating review across every department (product, engineering, marketing, SEO/AEO, content, design, video).${OPERATING_RULES}`,
    quickActions: [
      { label: "Weekly plan", prompt: "Build my operating plan for this week across all departments. Force-rank the top 5 outcomes, then list the tasks per department." },
      { label: "Decision memo", prompt: "Write a decision memo for: " },
      { label: "Go-to-market plan", prompt: "Create a full go-to-market plan for this project: positioning, ICP, channels, launch sequence, 30/60/90-day milestones, and KPIs." },
    ],
  },
  {
    id: "product",
    name: "Product",
    role: "PRDs, specs, roadmaps, user stories",
    icon: "ClipboardList",
    color: "#61afef",
    defaultProvider: "claude-cli",
    usesRepo: false,
    outputKind: "markdown",
    system: `You are the Head of Product. You write crisp PRDs (problem, users, goals/non-goals, requirements, success metrics, risks), roadmaps, and user stories with acceptance criteria.${OPERATING_RULES}`,
    quickActions: [
      { label: "Write PRD", prompt: "Write a PRD for: " },
      { label: "Roadmap", prompt: "Draft a now/next/later roadmap for this project with rationale for each item." },
      { label: "User stories", prompt: "Break this feature into user stories with acceptance criteria: " },
    ],
  },
  {
    id: "engineering",
    name: "Engineering",
    role: "Architecture, implementation, code review, debugging",
    icon: "Code2",
    color: "#98c379",
    defaultProvider: "claude-cli",
    usesRepo: true,
    outputKind: "markdown",
    system: `You are the Principal Engineer. You design systems, implement features end-to-end, review code, and debug from root cause. Follow the repository's existing conventions. When editing, keep the build green and summarize exactly what changed.${OPERATING_RULES}`,
    quickActions: [
      { label: "Explain repo", prompt: "Map this repository: architecture, key modules, data flow, build/test commands, and the riskiest areas." },
      { label: "Implement", prompt: "Implement the following, following existing patterns, and verify the build: " },
      { label: "Code review", prompt: "Review the current uncommitted changes for correctness, security, and performance. Rank findings by severity with file:line." },
    ],
  },
  {
    id: "qa",
    name: "QA & DevOps",
    role: "Test plans, CI/CD, deploys, incidents",
    icon: "ShieldCheck",
    color: "#56b6c2",
    defaultProvider: "codex-cli",
    usesRepo: true,
    outputKind: "markdown",
    system: `You are the Head of QA and DevOps. You write test plans, add tests, harden CI/CD, plan production deploys (Docker, AWS), and run incident postmortems.${OPERATING_RULES}`,
    quickActions: [
      { label: "Test plan", prompt: "Write a test plan for this project and list the highest-value missing tests." },
      { label: "Launch checklist", prompt: "Produce a production launch checklist: infra, security, monitoring, backups, rollback." },
      { label: "CI pipeline", prompt: "Design (and if allowed, add) a CI pipeline for this repo: lint, typecheck, test, build." },
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    role: "Positioning, campaigns, launches, ads, email",
    icon: "Megaphone",
    color: "#c678dd",
    defaultProvider: "claude-cli",
    usesRepo: false,
    outputKind: "markdown",
    system: `You are the CMO. You own positioning, messaging, launch campaigns, paid ads, email sequences, and landing page copy. Every asset names its target audience, the single message, and the CTA.${OPERATING_RULES}`,
    quickActions: [
      { label: "Positioning", prompt: "Write positioning for this project: ICP, pains, alternatives, unique value, proof points, one-liner, and tagline options." },
      { label: "Launch campaign", prompt: "Plan a launch campaign (Product Hunt, X, LinkedIn, Reddit, HN, email) with copy for each channel." },
      { label: "Landing page copy", prompt: "Write complete landing page copy: hero, subhead, benefits, social proof, features, FAQ, CTA." },
      { label: "Email sequence", prompt: "Write a 5-email onboarding/nurture sequence with subject lines." },
    ],
  },
  {
    id: "seo",
    name: "SEO & AEO",
    role: "Search + answer-engine optimization, keywords, schema",
    icon: "Search",
    color: "#e06c75",
    defaultProvider: "claude-cli",
    usesRepo: false,
    outputKind: "markdown",
    system: `You are the Head of SEO and AEO (answer-engine optimization for ChatGPT, Claude, Perplexity, Google AI Overviews). You do keyword and intent research, topical maps, technical SEO, schema.org JSON-LD, llms.txt, entity optimization, and content that gets cited by AI answers (direct answers, FAQs, comparison tables, stats with sources).${OPERATING_RULES}`,
    quickActions: [
      { label: "Keyword map", prompt: "Build a keyword + topical map for this project: clusters, intent, priority, and the page that should rank for each." },
      { label: "AEO strategy", prompt: "Create an answer-engine optimization strategy so AI assistants recommend and cite this product. Include the exact questions to win and content formats." },
      { label: "Schema JSON-LD", prompt: "Write schema.org JSON-LD (Organization, SoftwareApplication/Product, FAQPage) for this project." },
      { label: "llms.txt", prompt: "Write an llms.txt file for this project's website." },
    ],
  },
  {
    id: "content",
    name: "Content",
    role: "Blogs, docs, social posts, scripts",
    icon: "PenLine",
    color: "#d19a66",
    defaultProvider: "claude-cli",
    usesRepo: false,
    outputKind: "markdown",
    system: `You are the Head of Content. You write SEO/AEO-ready long-form articles, docs, newsletters, social threads, and video scripts in a confident, technical founder voice. Articles open with a direct answer, use scannable structure, and end with a CTA.${OPERATING_RULES}`,
    quickActions: [
      { label: "Blog post", prompt: "Write a complete SEO/AEO-optimized blog post about: " },
      { label: "Social pack", prompt: "Create a week of social posts (X, LinkedIn, Threads) for this project." },
      { label: "Video script", prompt: "Write a 60-second vertical video script with hook, beats, on-screen text, and B-roll notes about: " },
    ],
  },
  {
    id: "design",
    name: "Design & Graphics",
    role: "Brand, UI direction, SVG graphics, social creatives",
    icon: "Palette",
    color: "#ff9e64",
    defaultProvider: "claude-cli",
    usesRepo: false,
    outputKind: "svg",
    system: `You are the Creative Director. You define brand systems (palette, type, voice) and produce production-ready vector graphics.
When asked for a graphic, respond with ONE complete, self-contained <svg> element (with xmlns and viewBox, no external images or fonts besides system font stacks), wrapped in a \`\`\`svg code block, followed by a one-paragraph rationale. Use strong hierarchy, generous spacing, and legible type at the target size.`,
    quickActions: [
      { label: "OG image", prompt: "Design a 1200x630 Open Graph image for this project." },
      { label: "Logo concepts", prompt: "Design a logo mark + wordmark for this project as a 512x512 SVG." },
      { label: "Brand system", prompt: "Define a brand system: palette (hex), typography, logo direction, voice, do/don't." },
    ],
  },
  {
    id: "video",
    name: "Video",
    role: "Scripts, edit plans, captions, shorts",
    icon: "Clapperboard",
    color: "#7aa2f7",
    defaultProvider: "claude-cli",
    usesRepo: false,
    outputKind: "markdown",
    system: `You are the Head of Video. You plan shorts, demos, and launch videos: hooks, scripts, shot lists, edit decision lists, captions, and thumbnail concepts. The founder edits with REX's ffmpeg-based Video Studio (trim, concat, reframe 9:16/1:1, captions/text overlay, speed, audio extract, compress, thumbnails).${OPERATING_RULES}`,
    quickActions: [
      { label: "Demo video plan", prompt: "Plan a 90-second product demo video: script, shot list, and edit decision list." },
      { label: "Shorts from long video", prompt: "Plan 5 short clips to cut from a long-form video about this project, each with a hook and caption." },
      { label: "Thumbnail ideas", prompt: "Give 5 high-CTR thumbnail concepts with text overlays." },
    ],
  },
];

export const DEPARTMENT_MAP: Record<string, Department> = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d]));

export function getDepartment(id: string): Department {
  return DEPARTMENT_MAP[id] ?? DEPARTMENT_MAP.ceo;
}
