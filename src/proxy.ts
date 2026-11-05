import { NextResponse, type NextRequest } from "next/server";
import { sessionSecret } from "./lib/sessionSecret";

/**
 * Local-engine guard. REX's server runs on the user's machine and can run
 * agents, terminals and file operations, so:
 *  1. Host must be a loopback name (blocks DNS-rebinding attacks).
 *  2. Cross-origin browser requests are refused (Origin check).
 *  3. API calls must carry the install's session secret: a SameSite=Strict
 *     HttpOnly cookie set when the app page loads (other sites can't send it),
 *     or the `x-rex-token` header (rex CLI, integrated terminal).
 * The OAuth redirect target is exempt (top-level navigation from the provider;
 * it's protected by its one-time `state`).
 */

const COOKIE = "rex_session";
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOOPBACK.test(host)) return new NextResponse("REX only accepts local connections", { status: 403 });

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (!LOOPBACK.test(new URL(origin).host) || new URL(origin).host !== host) return new NextResponse("Cross-origin request refused", { status: 403 });
    } catch {
      return new NextResponse("Bad origin", { status: 403 });
    }
  }

  const secret = sessionSecret();
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/oauth/callback") return NextResponse.next();
    const ok = req.cookies.get(COOKIE)?.value === secret || req.headers.get("x-rex-token") === secret;
    if (!ok) return NextResponse.json({ error: "Not authorized. Reload REX." }, { status: 401 });
    return NextResponse.next();
  }

  // App pages: hand the browser the session cookie (same-site only, not readable by scripts).
  const res = NextResponse.next();
  if (req.cookies.get(COOKIE)?.value !== secret) {
    res.cookies.set(COOKIE, secret, { httpOnly: true, sameSite: "strict", path: "/", secure: false });
  }
  return res;
}

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
