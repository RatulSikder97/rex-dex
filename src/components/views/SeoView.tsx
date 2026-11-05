"use client";
import { useState } from "react";
import { Bot, Globe, Save, SearchCheck } from "lucide-react";
import { api } from "@/lib/client";
import { useActiveProject, useWorkbench } from "@/store/workbench";
import { ErrorState, Page, PageHeader, Pill, type Tone } from "@/components/ui/kit";
import { EmptyState, Skeleton } from "@/components/ui/empty";

interface AuditCheck { id: string; group: string; label: string; status: "pass" | "warn" | "fail"; detail: string; weight: number }
interface SeoAudit {
  url: string; finalUrl: string; fetchedAt: number; httpStatus: number; responseMs: number; score: number;
  title: string; metaDescription: string; headings: { level: number; text: string }[]; wordCount: number; schemaTypes: string[]; checks: AuditCheck[];
}

const STATUS_TONE: Record<AuditCheck["status"], Tone> = { pass: "ok", warn: "warn", fail: "err" };
const STATUS_LABEL: Record<AuditCheck["status"], string> = { pass: "Pass", warn: "Warn", fail: "Fail" };

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
  const scoreTone: Tone = !audit ? "neutral" : audit.score >= 80 ? "ok" : audit.score >= 55 ? "warn" : "err";
  const counts = audit ? { pass: audit.checks.filter((c) => c.status === "pass").length, warn: audit.checks.filter((c) => c.status === "warn").length, fail: audit.checks.filter((c) => c.status === "fail").length } : null;

  return (
    <Page>
      <div className="@container">
        <PageHeader
          title="SEO and AEO audit"
          description="Technical SEO, on-page content, social cards and answer-engine readiness (JSON-LD, FAQ, llms.txt, AI crawler access)."
          actions={
            audit && (
              <button className="btn" onClick={() => save().catch((e) => log("error", "seo", `Couldn’t save the report: ${e instanceof Error ? e.message : e}`))}>
                <Save size={13} /> Save report
              </button>
            )
          }
        />

        <form
          className="mb-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Globe size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <label htmlFor="seo-url" className="sr-only">
              Page URL
            </label>
            <input id="seo-url" className="input pl-8" type="url" inputMode="url" placeholder="https://yoursite.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary shrink-0" disabled={loading || !url.trim()}>
            <SearchCheck size={13} /> {loading ? "Auditing…" : "Run audit"}
          </button>
        </form>

        {loading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Running audit">
            <Skeleton className="h-[112px] w-full rounded-[6px]" />
            <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
              <Skeleton className="h-[180px] rounded-[6px]" />
              <Skeleton className="h-[180px] rounded-[6px]" />
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <ErrorState title="The audit didn’t finish" error={`${error}. Check that the URL is public and reachable, then try again.`} onRetry={run} />
          </div>
        ) : !audit ? (
          <div className="card">
            <EmptyState icon={SearchCheck} title="No audit yet" hint="Enter a page URL and choose Run audit. Fetches the page once and checks it against 30+ rules." />
          </div>
        ) : (
          <div className="space-y-4">
            <section className="card" aria-label="Summary">
              <div className="grid grid-cols-1 @2xl:grid-cols-[180px_minmax(0,1fr)]">
                <div className="flex flex-col justify-center gap-1.5 border-b border-line p-4 @2xl:border-b-0 @2xl:border-r">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[20px] font-semibold tabular-nums" style={{ color: `var(--${scoreTone === "neutral" ? "fg" : scoreTone})` }}>
                      {audit.score}
                    </span>
                    <span className="text-[12px] text-muted">/ 100</span>
                  </div>
                  {counts && (
                    <div className="flex flex-wrap gap-1">
                      <Pill tone="ok">{counts.pass} pass</Pill>
                      {counts.warn > 0 && <Pill tone="warn">{counts.warn} warn</Pill>}
                      {counts.fail > 0 && <Pill tone="err">{counts.fail} fail</Pill>}
                    </div>
                  )}
                  <div className="text-[11px] tabular-nums text-faint">
                    HTTP {audit.httpStatus} · {audit.responseMs} ms · {audit.wordCount} words
                  </div>
                </div>
                <dl className="min-w-0 space-y-2 p-4">
                  <div>
                    <dt className="label mb-0.5">Title</dt>
                    <dd className="break-words text-[13px]">{audit.title || <span className="text-err">Missing</span>}</dd>
                  </div>
                  <div>
                    <dt className="label mb-0.5">Meta description</dt>
                    <dd className="break-words text-[12.5px] text-muted">{audit.metaDescription || <span className="text-err">Missing</span>}</dd>
                  </div>
                  <div>
                    <dt className="label mb-0.5">URL</dt>
                    <dd className="truncate font-mono text-[11.5px] text-muted" title={audit.finalUrl}>
                      {audit.finalUrl}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5">
                <span className="mr-1 flex items-center gap-1.5 text-[12px] text-muted">
                  <Bot size={13} aria-hidden /> Ask the SEO agent
                </span>
                <button className="btn btn-sm" onClick={() => askAgent("Using this audit, write a prioritized fix plan (impact × effort), with exact code/markup for every fix, and a separate AEO plan to get cited by AI assistants.")}>
                  Fix plan
                </button>
                <button className="btn btn-sm" onClick={() => askAgent("Write production-ready schema.org JSON-LD for this site (Organization, WebSite, SoftwareApplication/Product, FAQPage with 6 real questions).")}>
                  JSON-LD
                </button>
                <button className="btn btn-sm" onClick={() => askAgent("Write an llms.txt for this site, plus 10 question-style H2s with direct 40-60 word answers for AEO.")}>
                  llms.txt and answers
                </button>
                <button className="btn btn-sm" onClick={() => askAgent("Rewrite the title tag and meta description (3 options each) and propose an H1/H2 outline optimized for the primary keyword intent.")}>
                  Meta rewrite
                </button>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
              {groups.map((g) => {
                const checks = audit.checks.filter((c) => c.group === g);
                const bad = checks.filter((c) => c.status !== "pass").length;
                return (
                  <section key={g} className="card min-w-0" aria-label={g}>
                    <div className="card-head">
                      <span className="min-w-0 flex-1 truncate" title={g}>
                        {g}
                      </span>
                      {bad > 0 ? <Pill tone="warn">{bad} to fix</Pill> : <Pill tone="ok">All pass</Pill>}
                    </div>
                    <ul className="divide-y divide-line">
                      {checks.map((c) => (
                        <li key={c.id} className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-3 py-2 text-[12.5px] @xl:grid-cols-[44px_160px_minmax(0,1fr)]">
                          <span className="pt-px">
                            <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
                          </span>
                          <span className="min-w-0 font-medium">{c.label}</span>
                          <span className="col-start-2 min-w-0 break-words text-[12px] text-muted @xl:col-start-3">{c.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>

            <section className="card" aria-label="Heading outline">
              <div className="card-head">Heading outline</div>
              <div className="card-body space-y-0.5 font-mono text-[12px]">
                {audit.headings.map((h, i) => (
                  <div key={i} className="break-words" style={{ paddingLeft: (h.level - 1) * 16 }}>
                    <span className="text-faint">H{h.level}</span> {h.text}
                  </div>
                ))}
                {!audit.headings.length && <div className="font-sans text-muted">No headings found.</div>}
              </div>
            </section>
          </div>
        )}
      </div>
    </Page>
  );
}
