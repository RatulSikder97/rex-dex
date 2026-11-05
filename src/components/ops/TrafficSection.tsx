"use client";
import { useMemo, useState } from "react";
import { Bot, FileText, Globe, Network, RefreshCw, Search, Server as ServerIcon, Users } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { ServerWithLast, Snapshot } from "@/lib/opsTypes";
import { EmptyState } from "@/components/ui/empty";
import { useWorkbench } from "@/store/workbench";
import { Bars, Card, ErrorBox, LoadingGrid, Pill, RankList, Spinner, StackBar, Stat, errMsg, fmtNum, handOff, ipHint, classifyAgent, useOpsFetch, type OpsNav, type Tone } from "./shared";
import { serversUrl } from "./ServersSection";

type Traffic = NonNullable<Snapshot["traffic"]>;

/** 60 one-minute buckets ending at the newest sample (missing minutes = 0). */
function lastHour(perMinute: Traffic["perMinute"]): { values: number[]; end: number } {
  if (!perMinute.length) return { values: Array(60).fill(0), end: Date.now() };
  const ms = (t: number) => (t < 1e12 ? t * 1000 : t);
  const byMin = new Map<number, number>();
  for (const p of perMinute) {
    const m = Math.floor(ms(p.t) / 60000);
    byMin.set(m, (byMin.get(m) ?? 0) + p.count);
  }
  const end = Math.max(...byMin.keys());
  return { values: Array.from({ length: 60 }, (_, i) => byMin.get(end - 59 + i) ?? 0), end: end * 60000 };
}

const KIND_PILL: Record<"ai" | "search" | "bot", { tone: Tone; label: string }> = {
  ai: { tone: "accent", label: "AI crawler" },
  search: { tone: "ok", label: "Search" },
  bot: { tone: "muted", label: "Bot" },
};

export default function TrafficSection({ nav }: { nav: OpsNav }) {
  const { data: list, error, setData } = useOpsFetch<ServerWithLast[]>(serversUrl(nav.projectId), nav.reloadKey);
  const log = useWorkbench((s) => s.log);
  const [busy, setBusy] = useState(false);
  const server = list?.find((s) => s.id === nav.serverId) ?? list?.[0] ?? null;

  if (!list && error) return <ErrorBox title="Couldn't load servers">{error}</ErrorBox>;
  if (!list) return <LoadingGrid n={4} />;
  if (!list.length)
    return (
      <Card>
        <EmptyState icon={ServerIcon} title="No servers yet" hint="Traffic comes from each server's web access log (nginx / Apache combined format). Add a server first." action={{ label: "Add server", onClick: () => nav.go("servers") }} />
      </Card>
    );

  const refresh = async () => {
    if (!server) return;
    setBusy(true);
    try {
      const snap = await api<Snapshot>(`/api/ops/servers/${server.id}/snapshot`, { method: "POST" });
      setData((l) => (l ?? []).map((x) => (x.id === server.id ? { ...x, last: snap } : x)));
      if (!snap.ok) log("error", "ops", `${server.name}: ${snap.error ?? "snapshot failed"}`);
    } catch (e) {
      log("error", "ops", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const snap = server?.last ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
          Server
          <select className="input h-7 w-56" value={server?.id ?? ""} onChange={(e) => nav.setServerId(e.target.value)} aria-label="Server">
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{snap ? `Snapshot ${timeAgo(snap.at)}` : "No snapshot yet"}</span>
        <button className="btn h-7" onClick={() => void refresh()} disabled={busy}>
          {busy ? <Spinner /> : <RefreshCw size={12} />} {busy ? "Reading logs…" : "Refresh snapshot"}
        </button>
      </div>

      {!snap ? (
        <Card>
          <EmptyState compact icon={RefreshCw} title="No snapshot yet" hint="Take a snapshot to parse the access log." action={{ label: "Take snapshot", onClick: () => void refresh() }} />
        </Card>
      ) : !snap.ok ? (
        <ErrorBox title="The last snapshot failed" action={<button className="btn h-7" onClick={() => nav.go("servers", server?.id)}>Open server</button>}>
          {snap.error}
        </ErrorBox>
      ) : (
        <>
          {snap.traffic ? <TrafficPanels t={snap.traffic} serverName={server!.name} /> : <NoLog logPath={server!.log_path} onEdit={() => nav.go("servers", server!.id)} />}
          <LiveConnections snap={snap} />
        </>
      )}
    </div>
  );
}

function NoLog({ logPath, onEdit }: { logPath: string | null; onEdit: () => void }) {
  return (
    <Card title="No access log data" icon={<FileText size={14} />}>
      <div className="space-y-2 text-[12px] leading-relaxed text-muted">
        <p>
          {logPath ? (
            <>
              REX couldn&apos;t read <code className="font-mono text-fg">{logPath}</code> on this server.
            </>
          ) : (
            "This server has no access log path set."
          )}{" "}
          Set the path to your web server&apos;s access log (combined format) on the server, e.g. <code className="font-mono text-fg">/var/log/nginx/access.log</code> or <code className="font-mono text-fg">/var/log/apache2/access.log</code>.
        </p>
        <p>
          The SSH user needs read access — typically add it to the <code className="font-mono text-fg">adm</code> group: <code className="font-mono text-fg">sudo usermod -aG adm $USER</code>.
        </p>
        <button className="btn h-7" onClick={onEdit}>
          Edit server
        </button>
      </div>
    </Card>
  );
}

function TrafficPanels({ t, serverName }: { t: Traffic; serverName: string }) {
  const hour = useMemo(() => lastHour(t.perMinute), [t.perMinute]);
  const hourTotal = hour.values.reduce((a, b) => a + b, 0);
  const peak = Math.max(0, ...hour.values);
  const errRate = t.lines ? ((t.status["5xx"] / t.lines) * 100).toFixed(2) : "0";
  const botTotal = t.bots.ai + t.bots.search + t.bots.other + t.bots.human;

  const askSeo = () =>
    handOff(
      "seo",
      `Review crawler traffic on ${serverName}. Are AI answer engines and search engines reaching the right pages? Recommend robots.txt / llms.txt / sitemap changes to improve SEO and AEO visibility.`,
      [
        `Access log ${t.source}, ${t.lines} requests analysed.`,
        `Bot breakdown: AI crawlers ${t.bots.ai}, search engines ${t.bots.search}, other bots ${t.bots.other}, humans ${t.bots.human}.`,
        `AI crawlers: ${t.aiCrawlers.map((c) => `${c.name}×${c.count}`).join(", ") || "none"}`,
        `Status codes: 2xx ${t.status["2xx"]}, 3xx ${t.status["3xx"]}, 4xx ${t.status["4xx"]}, 5xx ${t.status["5xx"]}.`,
        `Top paths: ${t.topPaths.slice(0, 15).map((p) => `${p.path}×${p.count}`).join(", ")}`,
        `Top user agents:\n${t.topAgents.slice(0, 15).map((a) => `  ${a.count}  ${a.agent}`).join("\n")}`,
      ].join("\n"),
    );

  return (
    <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
      <Card title="Requests per minute · last 60 min" icon={<Network size={14} />} className="@4xl:col-span-2">
        <div className="mb-3 grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          <Stat label="Last hour" value={fmtNum(hourTotal)} sub={`peak ${peak}/min`} />
          <Stat label="Analysed lines" value={fmtNum(t.lines)} sub={t.source} />
          <Stat label="5xx rate" value={`${errRate}%`} tone={Number(errRate) >= 1 ? "err" : Number(errRate) > 0 ? "warn" : undefined} />
          <Stat label="Humans" value={botTotal ? `${Math.round((t.bots.human / botTotal) * 100)}%` : "—"} sub={`${fmtNum(t.bots.human)} requests`} />
        </div>
        <Bars values={hour.values} height={80} label={`Requests per minute, last hour: total ${hourTotal}, peak ${peak}`} />
        <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-faint">
          <span>{new Date(hour.end - 59 * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <span>{new Date(hour.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </Card>

      <Card title="Status codes" icon={<Globe size={14} />}>
        <StackBar
          label="Status codes"
          parts={[
            { label: "2xx", value: t.status["2xx"], color: "var(--ok)" },
            { label: "3xx", value: t.status["3xx"], color: "var(--accent)" },
            { label: "4xx", value: t.status["4xx"], color: "var(--warn)" },
            { label: "5xx", value: t.status["5xx"], color: "var(--err)" },
          ]}
        />
      </Card>

      <Card
        title="Bots vs humans"
        icon={<Bot size={14} />}
        action={
          <button className="btn h-7" onClick={askSeo}>
            <Search size={12} /> Ask SEO &amp; AEO about crawler traffic
          </button>
        }
      >
        <StackBar
          label="Traffic by visitor type"
          parts={[
            { label: "AI crawlers", value: t.bots.ai, color: "var(--accent)" },
            { label: "Search engines", value: t.bots.search, color: "var(--ok)" },
            { label: "Other bots", value: t.bots.other, color: "var(--fg-faint)" },
            { label: "Humans", value: t.bots.human, color: "var(--warn)" },
          ]}
        />
        {!!t.aiCrawlers.length && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-medium text-muted">AI crawlers</div>
            <RankList rows={t.aiCrawlers.map((c) => ({ key: c.name, label: c.name, count: c.count }))} max={8} />
          </div>
        )}
      </Card>

      <Card title="Top IPs" icon={<Users size={14} />}>
        <RankList
          mono
          rows={t.topIps.map((x) => {
            const h = ipHint(x.ip);
            return { key: x.ip, label: x.ip, count: x.count, hint: h ? <Pill tone="muted" title="Likely owner, from well-known IP ranges">{h}</Pill> : undefined };
          })}
        />
      </Card>

      <Card title="Top paths" icon={<FileText size={14} />}>
        <RankList mono rows={t.topPaths.map((x) => ({ key: x.path, label: x.path, count: x.count }))} />
      </Card>

      <Card title="Top user agents" icon={<Bot size={14} />} className="@4xl:col-span-2">
        <RankList
          max={12}
          rows={t.topAgents.map((x) => {
            const c = classifyAgent(x.agent);
            return {
              key: x.agent,
              label: <span title={x.agent}>{x.agent || "(empty)"}</span>,
              count: x.count,
              hint: c.kind ? <Pill tone={KIND_PILL[c.kind].tone}>{c.name ? `${KIND_PILL[c.kind].label}: ${c.name}` : KIND_PILL[c.kind].label}</Pill> : undefined,
            };
          })}
        />
      </Card>
    </div>
  );
}

function LiveConnections({ snap }: { snap: Snapshot }) {
  const c = snap.connections;
  if (!c) return null;
  return (
    <Card title="Live connections" icon={<Network size={14} />}>
      <div className="flex flex-wrap items-start gap-6">
        <Stat label="Established now" value={c.established} sub={`at ${new Date(snap.at).toLocaleTimeString()}`} />
        <div className="min-w-[240px] flex-1">
          <RankList
            mono
            max={8}
            empty="No remote connections"
            rows={c.byIp.map((x) => {
              const h = ipHint(x.ip);
              return { key: x.ip, label: x.ip, count: x.count, hint: h ? <Pill tone="muted">{h}</Pill> : undefined };
            })}
          />
        </div>
      </div>
    </Card>
  );
}
