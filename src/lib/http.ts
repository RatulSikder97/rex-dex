import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps a route handler: zod errors → 400, everything else → 500 with message. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) return fail(err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
      const message = err instanceof Error ? err.message : String(err);
      console.error("[rex api]", message);
      return fail(message, 500);
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  return schema.parse(await req.json());
}
