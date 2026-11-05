import "server-only";
import type { GitInfo } from "../opsTypes";
import { errorOf, findBin, run } from "./exec";

/** git@github.com:o/r.git | https://gitlab.com/o/r.git | ssh://git@host/o/r → https web URL. */
export function webUrl(remote: string): string | null {
  let m = remote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  m = remote.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+?)(\.git)?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  m = remote.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(\.git)?$/);
  if (m) return `https://${m[1]}`;
  return null;
}

export async function gitInfo(root: string): Promise<GitInfo | null> {
  const git = findBin(["git"]) ?? "git";
  const g = (args: string[]) => run(git, args, { cwd: root, timeout: 15_000 });
  const inside = await g(["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) return null;
  const [branch, remotes, counts, log] = await Promise.all([
    g(["rev-parse", "--abbrev-ref", "HEAD"]),
    g(["remote", "-v"]),
    g(["rev-list", "--left-right", "--count", "@{u}...HEAD"]),
    g(["log", "-n", "15", "--pretty=format:%H%x1f%s%x1f%an%x1f%ct"]),
  ]);
  const seen = new Set<string>();
  const remoteList = remotes.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && !seen.has(p[0]) && seen.add(p[0]))
    .map(([name, url]) => ({ name, url, webUrl: webUrl(url) }));
  const [behind, ahead] = counts.ok ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];

  const gh = findBin(["gh"]);
  let ghInfo: GitInfo["gh"] = { available: false, prs: [], runs: [], issues: [] };
  if (!gh) ghInfo.error = "GitHub CLI not installed (brew install gh, then gh auth login)";
  else if (!remoteList.some((r) => r.webUrl?.includes("github.com"))) ghInfo.error = "No GitHub remote";
  else {
    const q = (args: string[]) => run(gh, args, { cwd: root, timeout: 20_000 });
    const [prs, runs, issues] = await Promise.all([
      q(["pr", "list", "--limit", "10", "--json", "number,title,url,author,isDraft"]),
      q(["run", "list", "--limit", "10", "--json", "name,headBranch,status,conclusion,url,createdAt"]),
      q(["issue", "list", "--limit", "10", "--json", "number,title,url,author"]),
    ]);
    const parse = <T,>(r: typeof prs): T[] => {
      try {
        return r.ok ? (JSON.parse(r.stdout) as T[]) : [];
      } catch {
        return [];
      }
    };
    ghInfo = {
      available: prs.ok || runs.ok || issues.ok,
      error: prs.ok || runs.ok || issues.ok ? undefined : errorOf(prs, "gh failed (run gh auth login)"),
      prs: parse<{ number: number; title: string; url: string; author?: { login?: string }; isDraft?: boolean }>(prs).map((p) => ({ number: p.number, title: p.title, url: p.url, author: p.author?.login ?? "", draft: !!p.isDraft })),
      runs: parse<{ name: string; headBranch: string; status: string; conclusion: string | null; url: string; createdAt: string }>(runs).map((r) => ({ name: r.name, branch: r.headBranch, status: r.status, conclusion: r.conclusion || null, url: r.url, at: Date.parse(r.createdAt) || 0 })),
      issues: parse<{ number: number; title: string; url: string; author?: { login?: string } }>(issues).map((i) => ({ number: i.number, title: i.title, url: i.url, author: i.author?.login ?? "" })),
    };
  }

  return {
    branch: branch.ok && branch.stdout.trim() !== "HEAD" ? branch.stdout.trim() : ((await g(["symbolic-ref", "--short", "HEAD"])).stdout.trim() || null),
    ahead: ahead || 0,
    behind: behind || 0,
    remotes: remoteList,
    commits: log.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, subject, author, ct] = l.split("\x1f");
        return { hash, subject, author, at: Number(ct) * 1000 };
      }),
    gh: ghInfo,
  };
}
