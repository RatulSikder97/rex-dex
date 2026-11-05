"use client";
import { useState } from "react";
import { Bot, Globe, Save } from "lucide-react";
import { api } from "@/lib/client";
import { useActiveProject, useWorkbench } from "@/store/workbench";

interface AuditCheck { id: string; group: string; label: string; status: "pass" | "warn" | "fail"; detail: string; weight: number }
interface SeoAudit {
  url: string; finalUrl: string; fetchedAt: number; httpStatus: number; responseMs: number; score: number;
  title: string; metaDescription: string; headings: { level: number; text: string }[]; wordCount: number; schemaTypes: string[]; checks: AuditCheck[];
}

const STATUS_STYLE = { pass: "text-ok", warn: "text-warn", fail: "text-err" } as const;
const STATUS_ICON = { pass: "✓", warn: "!", fail: "✕" } as const;

function toMarkdown(a: SeoAudit): string {
  const groups = [...new Set(a.checks.map((c) => c.group))];
  return `# SEO & AEO audit: ${a.finalUrl}\n\n**Score:** ${a.score}/100 · HTTP ${a.httpStatus} · ${a.responseMs} ms · ${a.wordCount} words\n\n${groups
    .map((g) => `## ${g}\n\n| Check | Status | Detail |\n|---|---|---|\n${a.checks.filter((c) => c.group === g).map((c) => `| ${c.label} | ${c.status} | ${c.detail.replace(/\|/g, "\\|")} |`).join("\n")}`)
    .join("\n\n")}\n\n## Headings\n\n${a.headings.map((h) => `${"  ".repeat(h.level - 1)}- H${h.level}: ${h.text}`).join("\n")}\n`;
}

export default function SeoView() {
  const project = useActiveProject();
  const { log, delegate, bump, openTab } = useWorkbench();
  const [url, setUrl] = useState(project?.website_url ?? "");
  const [audit, setAudit] = useState<SeoAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const a = await api<SeoAudit>("/api/seo/audit", { method: "POST", json: { url } });
      setAudit(a);
      log("ok", "seo", `Audited ${a.finalUrl}: score ${a.score}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      log("error", "seo", msg);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!audit) return;
    const d = await api<{ id: string; title: string }>("/api/deliverables", {
      method: "POST",
      json: { project_id: project?.id ?? null, department: "seo", kind: "markdown", title: `SEO audit · ${new URL(audit.finalUrl).hostname}`, content: toMarkdown(audit) },
    });
    bump();
    openTab({ kind: "deliverable", id: d.id }, d.title);
  };

  const askAgent = (brief: string) => audit && delegate({ department: "seo", brief, context: `SEO/AEO audit JSON:\n${JSON.stringify(audit, null, 1)}` });

  const groups = audit ? [...new Set(audit.checks.map((c) => c.group))] : [];
  const scoreColor = !audit ? "" : audit.score >= 80 ? "var(--ok)" : audit.score >= 55 ? "var(--warn)" : "var(--err)";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <div>
          <h1 className="text-lg font-semibold">SEO & AEO Auditor</h1>
          <p className="text-muted">Technical SEO, on-page, social cards, and answer-engine readiness (JSON-LD, FAQ, llms.txt, AI crawler access).</p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input h-8 pl-8" placeholder="https://yoursite.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
          </div>
          <button className="btn btn-primary h-8" onClick={run} disabled={loading || !url.trim()}>
            {loading ? "Auditing…" : "Run audit"}
          </button>
        </div>
        {error && <div className="rounded border border-err/40 bg-err/10 px-3 py-2 text-err">{error}</div>}

        {audit && (
          <>
            <div className="grid gap-4 md:grid-cols-[200px_1fr]">
              <div className="card flex flex-col items-center justify-center p-4">
                <div className="text-5xl font-bold tabular-nums" style={{ color: scoreColor }}>{audit.score}</div>
                <div className="mt-1 text-[11px] text-muted">score / 100</div>
                <div className="mt-3 text-center text-[11px] text-faint">
                  HTTP {audit.httpStatus} · {audit.responseMs} ms · {audit.wordCount} words
                </div>
              </div>
              <div className="card space-y-2 p-4">
                <div className="text-[11px] text-muted">TITLE</div>
                <div>{audit.title || <span className="text-err">missing</span>}</div>
                <div className="text-[11px] text-muted">META DESCRIPTION</div>
                <div className="text-[12.5px]">{audit.metaDescription || <span className="text-err">missing</span>}</div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button className="btn btn-primary" onClick={() => askAgent("Using this audit, write a prioritized fix plan (impact × effort), with exact code/markup for every fix, and a separate AEO plan to get cited by AI assistants.")}>
                    <Bot size={13} /> Fix plan from SEO agent
                  </button>
                  <button className="btn" onClick={() => askAgent("Write production-ready schema.org JSON-LD for this site (Organization, WebSite, SoftwareApplication/Product, FAQPage with 6 real questions).")}>
                    JSON-LD
                  </button>
                  <button className="btn" onClick={() => askAgent("Write an llms.txt for this site, plus 10 question-style H2s with direct 40-60 word answers for AEO.")}>
                    llms.txt + answers
                  </button>
                  <button className="btn" onClick={() => askAgent("Rewrite the title tag and meta description (3 options each) and propose an H1/H2 outline optimized for the primary keyword intent.")}>
                    Meta rewrite
                  </button>
                  <button className="btn" onClick={save}>
                    <Save size={13} /> Save report
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {groups.map((g) => (
                <div key={g} className="card p-4">
                  <div className="section-title mb-2">{g}</div>
                  <div className="space-y-1.5">
                    {audit.checks
                      .filter((c) => c.group === g)
                      .map((c) => (
                        <div key={c.id} className="flex gap-2 text-[12.5px]">
                          <span className={`w-4 shrink-0 text-center font-bold ${STATUS_STYLE[c.status]}`}>{STATUS_ICON[c.status]}</span>
                          <span className="w-44 shrink-0">{c.label}</span>
                          <span className="min-w-0 break-words text-muted">{c.detail}</span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="card p-4">
              <div className="section-title mb-2">Heading outline</div>
              <div className="space-y-0.5 font-mono text-[12px]">
                {audit.headings.map((h, i) => (
                  <div key={i} style={{ paddingLeft: (h.level - 1) * 16 }}>
                    <span className="text-faint">H{h.level}</span> {h.text}
                  </div>
                ))}
                {!audit.headings.length && <div className="text-muted">No headings found.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
