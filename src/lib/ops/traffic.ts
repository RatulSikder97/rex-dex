import "server-only";
import type { Snapshot } from "../opsTypes";

/**
 * Traffic analysis from a web server access log (nginx/apache "combined"
 * format): requests per minute, status mix, top IPs/paths/agents, and who is
 * a bot — AI crawlers (answer engines, training), search engines, other bots.
 * The AI-crawler split feeds straight into AEO work.
 */

const AI_CRAWLERS: [string, RegExp][] = [
  ["GPTBot (OpenAI)", /GPTBot/i],
  ["ChatGPT-User", /ChatGPT-User/i],
  ["OAI-SearchBot", /OAI-SearchBot/i],
  ["ClaudeBot (Anthropic)", /ClaudeBot|Claude-Web|anthropic-ai|Claude-User|Claude-SearchBot/i],
  ["PerplexityBot", /Perplexity(Bot|-User)/i],
  ["Google-Extended", /Google-Extended/i],
  ["Applebot-Extended", /Applebot-Extended/i],
  ["CCBot (Common Crawl)", /CCBot/i],
  ["Bytespider (ByteDance)", /Bytespider/i],
  ["Amazonbot", /Amazonbot/i],
  ["Meta AI", /meta-externalagent|FacebookBot/i],
  ["cohere-ai", /cohere-ai/i],
  ["DuckAssistBot", /DuckAssistBot/i],
  ["YouBot", /YouBot/i],
  ["MistralAI-User", /MistralAI/i],
];
const SEARCH = /Googlebot|bingbot|DuckDuckBot|YandexBot|Baiduspider|Applebot(?!-Extended)|Slurp|Sogou|SeznamBot|Qwantify|Naver/i;
const OTHER_BOT = /bot|crawl|spider|slurp|curl|wget|python|httpclient|go-http|java\/|okhttp|axios|node-fetch|headless|scrapy|uptime|monitor|pingdom|semrush|ahrefs|mj12/i;

// 1.2.3.4 - user [05/Nov/2026:06:04:30 +0000] "GET /path HTTP/1.1" 200 123 "ref" "UA"
const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:([A-Z]+) )?([^" ]*)[^"]*" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseTime(t: string): number {
  const m = t.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!m) return NaN;
  const utc = Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]);
  const off = (+m[8] * 60 + +m[9]) * 60_000 * (m[7] === "+" ? 1 : -1);
  return utc - off;
}

const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function parseAccessLog(lines: string[], source: string): NonNullable<Snapshot["traffic"]> {
  const ips = new Map<string, number>();
  const paths = new Map<string, number>();
  const agents = new Map<string, number>();
  const ai = new Map<string, number>();
  const minutes = new Map<number, number>();
  const status = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  const bots = { ai: 0, search: 0, other: 0, human: 0 };
  let parsed = 0;
  let latest = 0;

  for (const line of lines) {
    const m = line.match(LINE);
    if (!m) continue;
    parsed++;
    const [, ip, time, , rawPath, code, ua = ""] = m;
    bump(ips, ip);
    bump(paths, (rawPath || "/").split("?")[0].slice(0, 120));
    bump(agents, ua.slice(0, 120) || "(none)");
    const c = code[0];
    if (c === "2") status["2xx"]++;
    else if (c === "3") status["3xx"]++;
    else if (c === "4") status["4xx"]++;
    else if (c === "5") status["5xx"]++;
    const crawler = AI_CRAWLERS.find(([, re]) => re.test(ua));
    if (crawler) {
      bots.ai++;
      bump(ai, crawler[0]);
    } else if (SEARCH.test(ua)) bots.search++;
    else if (OTHER_BOT.test(ua) || !ua) bots.other++;
    else bots.human++;
    const t = parseTime(time);
    if (Number.isFinite(t)) {
      const minute = Math.floor(t / 60_000) * 60_000;
      minutes.set(minute, (minutes.get(minute) ?? 0) + 1);
      if (t > latest) latest = t;
    }
  }

  // Last 60 minutes relative to the newest log line (server and REX clocks may differ).
  const end = Math.floor((latest || Date.now()) / 60_000) * 60_000;
  const perMinute = Array.from({ length: 60 }, (_, i) => {
    const t = end - (59 - i) * 60_000;
    return { t, count: minutes.get(t) ?? 0 };
  });

  return {
    source,
    lines: parsed,
    perMinute,
    status,
    topIps: top(ips, 15).map(([ip, count]) => ({ ip, count })),
    topPaths: top(paths, 15).map(([path, count]) => ({ path, count })),
    topAgents: top(agents, 10).map(([agent, count]) => ({ agent, count })),
    bots,
    aiCrawlers: top(ai, 15).map(([name, count]) => ({ name, count })),
  };
}
