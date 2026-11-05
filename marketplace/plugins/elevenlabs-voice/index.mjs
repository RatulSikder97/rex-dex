// REX extension: ElevenLabs text-to-speech provider.
// Runs inside the REX server after the user trusts this extension.
import fs from "node:fs/promises";

const API = "https://api.elevenlabs.io/v1";

/** @param {{ registerTts: Function, getSetting: (k: string) => string | undefined, log: (m: string) => void }} api */
export function activate(api) {
  const key = () => api.getSetting("ELEVENLABS_API_KEY");
  let cachedVoices = null;

  const provider = {
    id: "elevenlabs",
    label: "ElevenLabs",
    format: "mp3",
    async available() {
      return key() ? { ok: true, detail: "API key configured" } : { ok: false, detail: "Set ELEVENLABS_API_KEY in the extension settings" };
    },
    async voices() {
      if (!key()) return [];
      if (cachedVoices) return cachedVoices;
      const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key() }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`ElevenLabs voices failed: ${res.status}`);
      const data = await res.json();
      cachedVoices = (data.voices ?? []).map((v) => ({ id: v.voice_id, label: `${v.name}${v.labels?.accent ? ` (${v.labels.accent})` : ""}` }));
      return cachedVoices;
    },
    async synthesize({ text, voice, outPath, signal }) {
      if (!key()) throw new Error("ElevenLabs API key is not set");
      const voiceId = voice || (await provider.voices())[0]?.id;
      if (!voiceId) throw new Error("No ElevenLabs voice available");
      const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key(), "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: api.getSetting("MODEL_ID") || "eleven_multilingual_v2" }),
        signal,
      });
      if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text().catch(() => "")}`.trim());
      await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    },
  };
  api.registerTts(provider);
  api.log("ElevenLabs voice provider registered");
}
