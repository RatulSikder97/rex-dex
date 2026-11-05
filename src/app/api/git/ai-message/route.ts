import { z } from "zod";
import { projectRoot } from "@/lib/fsx";
import { isRepo, stagedDiff } from "@/lib/git";
import { body, fail, handle, ok } from "@/lib/http";
import { runToText } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Schema = z.object({ projectId: z.string(), provider: z.string().max(40).nullish() });

/** POST /api/git/ai-message {projectId, provider} → {message} written from the staged diff. */
export const POST = handle(async (req: Request) => {
  const { projectId, provider } = await body(req, Schema);
  const root = projectRoot(projectId);
  if (root instanceof Response) return root;
  if (!(await isRepo(root))) return fail("Not a git repository", 400);
  const diff = await stagedDiff(root, 60_000);
  if (!diff.trim() || !diff.includes("diff --git")) return fail("Nothing staged. Stage changes first.", 400);
  const brief = [
    "Write a git commit message for the staged diff below, following the Conventional Commits spec.",
    "Format: `type(optional-scope): imperative summary` (max 72 chars), then a blank line, then a concise body of bullet points only if the change is non-trivial.",
    "Types: feat, fix, refactor, perf, docs, style, test, build, ci, chore.",
    "Do NOT use any tools, do NOT edit files. Output ONLY the commit message text: no preamble, no code fences, no quotes.",
    "",
    "```diff",
    diff,
    "```",
  ].join("\n");
  const raw = await runToText({ department: "engineering", provider, brief, projectId });
  const message = raw
    .trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();
  return ok({ message });
});
