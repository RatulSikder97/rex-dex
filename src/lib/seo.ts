import "server-only";
import * as cheerio from "cheerio";

export interface AuditCheck {
  id: string;
  group: "Technical SEO" | "On-page" | "Social" | "AEO (AI answers)";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  weight: number;
}

export interface SeoAudit {
  url: string;
  finalUrl: string;
  fetchedAt: number;
  httpStatus: number;
  responseMs: number;
  score: number;
  title: string;
  metaDescription: string;
  headings: { level: number; text: string }[];
  wordCount: number;
  schemaTypes: string[];
  checks: AuditCheck[];
}

const UA = "REX-SEO-Auditor/0.1 (+local)";

async function fetchText(url: string, timeoutMs = 15000): Promise<{ status: number; text: string; finalUrl: string; ms: number } | null> {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { status: res.status, text, finalUrl: res.url, ms: Date.now() - started };
  } catch {
    return null;
  }
}

function normalizeUrl(raw: string): URL {
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const u = new URL(withProto);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) URLs are supported");
  return u;
}

function collectSchemaTypes(json: unknown, out: Set<string>) {
  if (Array.isArray(json)) return json.forEach((j) => collectSchemaTypes(j, out));
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
    for (const v of Object.values(o)) if (v && typeof v === "object") collectSchemaTypes(v, out);
  }
}

export async function auditUrl(rawUrl: string): Promise<SeoAudit> {
  const url = normalizeUrl(rawUrl);
  const page = await fetchText(url.toString());
  if (!page) throw new Error(`Could not fetch ${url.toString()}`);

  const origin = new URL(page.finalUrl).origin;
  const [robots, sitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`, 8000),
    fetchText(`${origin}/sitemap.xml`, 8000),
    fetchText(`${origin}/llms.txt`, 8000),
  ]);

  const $ = cheerio.load(page.text);
  const title = $("head > title").first().text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const canonical = $('link[rel="canonical"]').attr("href") ?? "";
  const viewport = $('meta[name="viewport"]').attr("content") ?? "";
  const lang = $("html").attr("lang") ?? "";
  const robotsMeta = ($('meta[name="robots"]').attr("content") ?? "").toLowerCase();
  const og = (p: string) => $(`meta[property="og:${p}"]`).attr("content") ?? "";
  const twitterCard = $('meta[name="twitter:card"]').attr("content") ?? "";

  const headings: { level: number; text: string }[] = [];
  $("h1,h2,h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) headings.push({ level: Number(el.tagName.slice(1)), text: text.slice(0, 140) });
  });
  const h1Count = headings.filter((h) => h.level === 1).length;

  const images = $("img");
  const missingAlt = images.filter((_, el) => !($(el).attr("alt") ?? "").trim()).length;

  const schemaTypes = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectSchemaTypes(JSON.parse($(el).contents().text()), schemaTypes);
    } catch {
      /* invalid JSON-LD is reported via the schema check */
    }
  });

  const bodyText = $("body").clone().find("script,style,noscript,svg").remove().end().text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;
  const questionHeadings = headings.filter((h) => /\?$|^(what|how|why|when|which|who|can|does|is|are)\b/i.test(h.text)).length;
  const hasLists = $("ul li, ol li").length >= 3;
  const hasTables = $("table").length > 0;

  const robotsBlocksAI =
    robots && robots.status === 200 && /user-agent:\s*(gptbot|claudebot|perplexitybot|google-extended)[\s\S]*?disallow:\s*\/\s*$/im.test(robots.text);

  const checks: AuditCheck[] = [];
  const add = (c: AuditCheck) => checks.push(c);

  add({ id: "status", group: "Technical SEO", label: "HTTP status", weight: 10, status: page.status === 200 ? "pass" : "fail", detail: `Responded ${page.status}` });
  add({ id: "https", group: "Technical SEO", label: "HTTPS", weight: 6, status: page.finalUrl.startsWith("https://") ? "pass" : "fail", detail: page.finalUrl });
  add({ id: "speed", group: "Technical SEO", label: "Server response time", weight: 5, status: page.ms < 800 ? "pass" : page.ms < 2000 ? "warn" : "fail", detail: `${page.ms} ms (HTML document)` });
  add({ id: "indexable", group: "Technical SEO", label: "Indexable", weight: 10, status: robotsMeta.includes("noindex") ? "fail" : "pass", detail: robotsMeta ? `meta robots: ${robotsMeta}` : "No noindex directive" });
  add({ id: "canonical", group: "Technical SEO", label: "Canonical URL", weight: 4, status: canonical ? "pass" : "warn", detail: canonical || "Missing <link rel=canonical>" });
  add({ id: "robots", group: "Technical SEO", label: "robots.txt", weight: 3, status: robots?.status === 200 ? "pass" : "warn", detail: robots?.status === 200 ? "Present" : "Not found" });
  add({ id: "sitemap", group: "Technical SEO", label: "sitemap.xml", weight: 4, status: sitemap?.status === 200 && (sitemap.text.includes("<urlset") || sitemap.text.includes("<sitemapindex")) ? "pass" : "warn", detail: sitemap?.status === 200 ? "Present" : "Not found at /sitemap.xml" });
  add({ id: "viewport", group: "Technical SEO", label: "Mobile viewport", weight: 4, status: viewport ? "pass" : "fail", detail: viewport || "Missing viewport meta" });
  add({ id: "lang", group: "Technical SEO", label: "html lang", weight: 2, status: lang ? "pass" : "warn", detail: lang || "Missing lang attribute" });

  add({ id: "title", group: "On-page", label: "Title tag", weight: 8, status: !title ? "fail" : title.length >= 30 && title.length <= 60 ? "pass" : "warn", detail: title ? `${title.length} chars — "${title}"` : "Missing" });
  add({ id: "description", group: "On-page", label: "Meta description", weight: 6, status: !metaDescription ? "fail" : metaDescription.length >= 70 && metaDescription.length <= 160 ? "pass" : "warn", detail: metaDescription ? `${metaDescription.length} chars` : "Missing" });
  add({ id: "h1", group: "On-page", label: "Single H1", weight: 6, status: h1Count === 1 ? "pass" : h1Count === 0 ? "fail" : "warn", detail: `${h1Count} H1 found` });
  add({ id: "content", group: "On-page", label: "Content depth", weight: 5, status: wordCount >= 600 ? "pass" : wordCount >= 250 ? "warn" : "fail", detail: `${wordCount} words` });
  add({ id: "alt", group: "On-page", label: "Image alt text", weight: 3, status: missingAlt === 0 ? "pass" : missingAlt <= 2 ? "warn" : "fail", detail: `${missingAlt}/${images.length} images missing alt` });

  const ogOk = og("title") && og("description") && og("image");
  add({ id: "og", group: "Social", label: "Open Graph", weight: 4, status: ogOk ? "pass" : og("title") ? "warn" : "fail", detail: ogOk ? "title, description, image set" : `Missing: ${["title", "description", "image"].filter((p) => !og(p)).join(", ")}` });
  add({ id: "twitter", group: "Social", label: "Twitter card", weight: 2, status: twitterCard ? "pass" : "warn", detail: twitterCard || "Missing twitter:card" });

  add({ id: "schema", group: "AEO (AI answers)", label: "Structured data (JSON-LD)", weight: 8, status: schemaTypes.size ? "pass" : "fail", detail: schemaTypes.size ? [...schemaTypes].join(", ") : "No JSON-LD found" });
  add({ id: "faq", group: "AEO (AI answers)", label: "FAQ / Q&A content", weight: 5, status: schemaTypes.has("FAQPage") || questionHeadings >= 3 ? "pass" : questionHeadings ? "warn" : "fail", detail: `${questionHeadings} question-style headings${schemaTypes.has("FAQPage") ? ", FAQPage schema" : ""}` });
  add({ id: "llms", group: "AEO (AI answers)", label: "llms.txt", weight: 4, status: llms?.status === 200 && !/<html/i.test(llms.text) ? "pass" : "warn", detail: llms?.status === 200 ? "Present" : "Not found at /llms.txt" });
  add({ id: "aibots", group: "AEO (AI answers)", label: "AI crawlers allowed", weight: 5, status: robotsBlocksAI ? "fail" : "pass", detail: robotsBlocksAI ? "robots.txt blocks an AI crawler (GPTBot/ClaudeBot/PerplexityBot/Google-Extended)" : "No AI crawler blocks detected" });
  add({ id: "scannable", group: "AEO (AI answers)", label: "Extractable structure", weight: 4, status: hasLists && (hasTables || headings.length >= 6) ? "pass" : hasLists || headings.length >= 4 ? "warn" : "fail", detail: `${headings.length} headings, ${hasLists ? "lists" : "no lists"}, ${hasTables ? "tables" : "no tables"}` });

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.status === "pass" ? c.weight : c.status === "warn" ? c.weight / 2 : 0), 0);

  return {
    url: url.toString(),
    finalUrl: page.finalUrl,
    fetchedAt: Date.now(),
    httpStatus: page.status,
    responseMs: page.ms,
    score: Math.round((earned / total) * 100),
    title,
    metaDescription,
    headings: headings.slice(0, 60),
    wordCount,
    schemaTypes: [...schemaTypes],
    checks,
  };
}
