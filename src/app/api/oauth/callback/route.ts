import { finishOAuth } from "@/lib/oauth/mcpOAuth";

export const dynamic = "force-dynamic";

const page = (ok: boolean, title: string, detail: string, connectionId?: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#16171a;color:#e6e7ea;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.card{max-width:420px;padding:32px 36px;border:1px solid #2c2e33;border-radius:16px;background:#1d1f23;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.4)}
.icon{width:52px;height:52px;margin:0 auto 14px;border-radius:14px;display:grid;place-items:center;font-size:26px;background:${ok ? "rgba(95,184,101,.15);color:#5fb865" : "rgba(247,84,100,.15);color:#f75464"}}
h1{font-size:18px;margin:0 0 6px}p{margin:0;color:#9da0a8}</style></head>
<body><div class="card"><div class="icon">${ok ? "✓" : "!"}</div><h1>${title}</h1><p>${detail}</p></div>
<script>try{window.opener&&window.opener.postMessage(${JSON.stringify({ type: "rex-oauth", ok, connectionId: connectionId ?? null })},"*")}catch(e){};${ok ? "setTimeout(function(){window.close()},1500)" : ""}</script></body></html>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** OAuth redirect target for browser sign-ins started from Connections. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  if (sp.get("error")) return html(page(false, "Sign-in cancelled", esc(sp.get("error_description") || sp.get("error") || "")), 400);
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return html(page(false, "Sign-in failed", "Missing authorization code."), 400);
  try {
    const id = await finishOAuth(state, code);
    return html(page(true, "Connected to REX", "You can close this tab: REX's agents can now use this service.", id));
  } catch (e) {
    return html(page(false, "Sign-in failed", esc(e instanceof Error ? e.message : String(e))), 400);
  }
}
