#!/usr/bin/env node
// rex-google-mcp — MCP server (stdio) for Google Analytics 4 + Search Console.
//
// Auth = your Google account via gcloud Application Default Credentials
// (`gcloud auth application-default login` opens the browser; REX runs it for
// you from Connections). No API keys, no service-account files.
//
//   rex-google-mcp.mjs --product ga|gsc|all     serve MCP tools on stdio
//   rex-google-mcp.mjs --setup                  pick/create a Cloud project, enable APIs, set quota project
//   rex-google-mcp.mjs --check                  exit 0 when signed in and set up

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/share/google-cloud-sdk/bin", "/usr/local/share/google-cloud-sdk/bin", path.join(os.homedir(), "google-cloud-sdk/bin")];
const env = { ...process.env, PATH: [...new Set([...(process.env.PATH ?? "").split(":"), ...PATHS])].join(":"), CLOUDSDK_CORE_DISABLE_PROMPTS: "1" };
const ADC = path.join(process.env.CLOUDSDK_CONFIG || path.join(os.homedir(), ".config", "gcloud"), "application_default_credentials.json");
const APIS = ["analyticsdata.googleapis.com", "analyticsadmin.googleapis.com", "searchconsole.googleapis.com"];

const gcloud = (args, timeout = 120_000) => run("gcloud", args, { env, timeout, maxBuffer: 8 * 1024 * 1024 });

function adc() {
  try {
    return JSON.parse(fs.readFileSync(ADC, "utf8"));
  } catch {
    return null;
  }
}

let cached = { token: null, at: 0 };
async function token() {
  if (cached.token && Date.now() - cached.at < 45 * 60_000) return cached.token;
  const { stdout } = await gcloud(["auth", "application-default", "print-access-token"], 30_000);
  cached = { token: stdout.trim(), at: Date.now() };
  return cached.token;
}

async function google(url, init = {}) {
  const quota = adc()?.quota_project_id;
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(quota ? { "x-goog-user-project": quota } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google API ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------- setup

async function setup() {
  if (!adc()) throw new Error("Not signed in: run gcloud auth application-default login");
  let project = adc()?.quota_project_id || "";
  if (!project) project = (await gcloud(["config", "get-value", "project"]).catch(() => ({ stdout: "" }))).stdout.trim();
  if (!project || project === "(unset)") {
    const list = await gcloud(["projects", "list", "--format=value(projectId)", "--limit=1"]).catch(() => ({ stdout: "" }));
    project = list.stdout.trim().split("\n")[0] || "";
  }
  if (!project) {
    project = `rex-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
    console.error(`Creating Google Cloud project ${project} (free) for API quota…`);
    await gcloud(["projects", "create", project, "--name=REX"], 180_000);
  }
  console.error(`Using Google Cloud project ${project}; enabling Analytics + Search Console APIs…`);
  await gcloud(["services", "enable", ...APIS, `--project=${project}`], 300_000);
  await gcloud(["auth", "application-default", "set-quota-project", project], 60_000);
  console.error("Google is connected.");
}

async function check() {
  if (!adc()?.quota_project_id) process.exit(1);
  await token();
}

// ---------------------------------------------------------------- tools

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

const GA_TOOLS = {
  ga_list_properties: {
    description: "List the Google Analytics 4 accounts and properties this Google account can access (property IDs for the other tools).",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const out = [];
      let pageToken;
      do {
        const r = await google(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`);
        for (const a of r.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ account: a.displayName, property: p.displayName, propertyId: p.property.replace("properties/", "") });
        pageToken = r.nextPageToken;
      } while (pageToken);
      return out;
    },
  },
  ga_run_report: {
    description: "Run a GA4 report (Data API runReport). Example metrics: activeUsers, sessions, screenPageViews, conversions, totalRevenue, bounceRate, averageSessionDuration. Example dimensions: date, sessionDefaultChannelGroup, sessionSource, pagePath, country, deviceCategory, landingPage.",
    inputSchema: {
      type: "object",
      required: ["property_id", "metrics"],
      properties: {
        property_id: { type: "string" },
        metrics: { type: "array", items: { type: "string" } },
        dimensions: { type: "array", items: { type: "string" } },
        start_date: { type: "string", description: "YYYY-MM-DD or NdaysAgo (default 28daysAgo)" },
        end_date: { type: "string", description: "YYYY-MM-DD or today (default today)" },
        limit: { type: "number" },
        order_by_metric: { type: "string", description: "Metric to sort descending by" },
      },
    },
    run: async (a) =>
      google(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(a.property_id)}:runReport`, {
        method: "POST",
        body: JSON.stringify({
          dateRanges: [{ startDate: a.start_date || "28daysAgo", endDate: a.end_date || "today" }],
          metrics: a.metrics.map((name) => ({ name })),
          dimensions: (a.dimensions ?? []).map((name) => ({ name })),
          limit: Math.min(a.limit || 50, 10000),
          ...(a.order_by_metric ? { orderBys: [{ metric: { metricName: a.order_by_metric }, desc: true }] } : {}),
        }),
      }),
  },
  ga_realtime: {
    description: "GA4 realtime report (last 30 minutes), e.g. metrics activeUsers with dimensions country, unifiedScreenName.",
    inputSchema: { type: "object", required: ["property_id"], properties: { property_id: { type: "string" }, metrics: { type: "array", items: { type: "string" } }, dimensions: { type: "array", items: { type: "string" } } } },
    run: async (a) =>
      google(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(a.property_id)}:runRealtimeReport`, {
        method: "POST",
        body: JSON.stringify({ metrics: (a.metrics?.length ? a.metrics : ["activeUsers"]).map((name) => ({ name })), dimensions: (a.dimensions ?? []).map((name) => ({ name })) }),
      }),
  },
};

const GSC_TOOLS = {
  gsc_list_sites: {
    description: "List the Search Console properties (sites) this Google account can access.",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await google("https://www.googleapis.com/webmasters/v3/sites")).siteEntry ?? [],
  },
  gsc_search_analytics: {
    description: "Search Console performance: clicks, impressions, CTR, position. Dimensions: query, page, country, device, date, searchAppearance.",
    inputSchema: {
      type: "object",
      required: ["site_url"],
      properties: {
        site_url: { type: "string", description: "e.g. https://example.com/ or sc-domain:example.com" },
        start_date: { type: "string", description: "YYYY-MM-DD (default 28 days ago)" },
        end_date: { type: "string", description: "YYYY-MM-DD (default today)" },
        dimensions: { type: "array", items: { type: "string" } },
        row_limit: { type: "number" },
        query_contains: { type: "string" },
        page_contains: { type: "string" },
      },
    },
    run: async (a) => {
      const filters = [];
      if (a.query_contains) filters.push({ dimension: "query", operator: "contains", expression: a.query_contains });
      if (a.page_contains) filters.push({ dimension: "page", operator: "contains", expression: a.page_contains });
      return google(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(a.site_url)}/searchAnalytics/query`, {
        method: "POST",
        body: JSON.stringify({
          startDate: a.start_date || daysAgo(28),
          endDate: a.end_date || today(),
          dimensions: a.dimensions?.length ? a.dimensions : ["query"],
          rowLimit: Math.min(a.row_limit || 100, 25000),
          ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
        }),
      });
    },
  },
  gsc_inspect_url: {
    description: "URL Inspection: index status, coverage, canonical, mobile usability and rich results for one URL.",
    inputSchema: { type: "object", required: ["site_url", "url"], properties: { site_url: { type: "string" }, url: { type: "string" } } },
    run: async (a) => google("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", body: JSON.stringify({ inspectionUrl: a.url, siteUrl: a.site_url }) }),
  },
  gsc_list_sitemaps: {
    description: "List submitted sitemaps and their status for a Search Console site.",
    inputSchema: { type: "object", required: ["site_url"], properties: { site_url: { type: "string" } } },
    run: async (a) => (await google(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(a.site_url)}/sitemaps`)).sitemap ?? [],
  },
};

// ---------------------------------------------------------------- MCP stdio (JSON-RPC 2.0, newline-delimited)

function serve(product) {
  const tools = { ...(product !== "gsc" ? GA_TOOLS : {}), ...(product !== "ga" ? GSC_TOOLS : {}) };
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const { id, method, params } = msg;
      if (id === undefined) continue; // notifications
      try {
        if (method === "initialize") {
          send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rex-google", version: "1.0.0" } } });
        } else if (method === "tools/list") {
          send({ jsonrpc: "2.0", id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) } });
        } else if (method === "tools/call") {
          const t = tools[params?.name];
          if (!t) throw new Error(`Unknown tool ${params?.name}`);
          try {
            const data = await t.run(params.arguments ?? {});
            send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 1).slice(0, 200_000) }] } });
          } catch (e) {
            send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] } });
          }
        } else if (method === "ping") {
          send({ jsonrpc: "2.0", id, result: {} });
        } else {
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
        }
      } catch (e) {
        send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message ?? e) } });
      }
    }
  });
}

const argv = process.argv.slice(2);
if (argv.includes("--setup")) setup().catch((e) => (console.error(String(e?.message ?? e)), process.exit(1)));
else if (argv.includes("--check")) check().catch(() => process.exit(1));
else serve(argv[argv.indexOf("--product") + 1] || "all");
