import { handle, ok } from "@/lib/http";
import { listProviders } from "@/lib/media/providers";

export const dynamic = "force-dynamic";

/** Voice (TTS) and image providers: built-in + from trusted extension code. */
export const GET = handle(async () => ok(await listProviders()));
