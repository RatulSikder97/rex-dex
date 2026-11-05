import { fail } from "@/lib/http";
import { attachTerminal, type TerminalEvent } from "@/lib/terminal";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** SSE: scrollback replay first, then live output. `data` events carry JSON-encoded TerminalEvents. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const encoder = new TextEncoder();
  let cleanup = () => {};
  let attached = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (ev: TerminalEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        if (ev.type === "exit") queueMicrotask(close);
      };
      const unsub = attachTerminal(id, send);
      if (!unsub) {
        closed = true;
        controller.close();
        return;
      }
      attached = true;
      const heartbeat = setInterval(() => !closed && controller.enqueue(encoder.encode(": ping\n\n")), 15000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };
      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  if (!attached) return fail("Terminal not found", 404);
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
