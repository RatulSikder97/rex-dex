import { subscribeRun } from "@/lib/runs";
import type { RunEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Server-Sent Events: a snapshot first, then live chunks until the run settles. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const encoder = new TextEncoder();
  let cleanup = () => {};

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
      const send = (ev: RunEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        const settled = (ev.type === "status" && ev.status !== "running") || (ev.type === "snapshot" && ev.status !== "running");
        if (settled) queueMicrotask(close);
      };
      const heartbeat = setInterval(() => !closed && controller.enqueue(encoder.encode(": ping\n\n")), 15000);
      const unsub = subscribeRun(id, send);
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

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
