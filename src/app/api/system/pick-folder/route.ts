import { z } from "zod";
import { body, handle, ok } from "@/lib/http";
import { pickFolderNative } from "@/lib/system";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const Schema = z.object({ prompt: z.string().max(200).default("Choose a folder"), startIn: z.string().max(1000).optional() });

/** POST → opens the OS folder picker (Finder on macOS) on this machine; {path: null} when cancelled. */
export const POST = handle(async (req: Request) => {
  const { prompt, startIn } = await body(req, Schema);
  return ok(await pickFolderNative(prompt, startIn));
});
