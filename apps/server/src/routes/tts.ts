import { Router } from "express";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import crypto from "crypto";

export const ttsRouter = Router();

// In-memory cache for synthesized audio chunks (limit to 100 entries to save RAM)
const ttsCache = new Map<string, { buffer: Buffer; ts: number }>();
const MAX_CACHE_ITEMS = 100;

export const SUPPORTED_VOICES = [
  {
    id: "en-US-BrianMultilingualNeural",
    name: "Brian (Multilingual AI - Erkak, eng jonli)",
    gender: "male",
    lang: "multilingual",
    badge: "Tavsiya etiladi",
  },
  {
    id: "en-US-AvaMultilingualNeural",
    name: "Ava (Multilingual AI - Ayol, eng jonli)",
    gender: "female",
    lang: "multilingual",
    badge: "Tavsiya etiladi",
  },
  {
    id: "uz-UZ-SardorNeural",
    name: "Sardor (Standart O'zbekcha - Erkak)",
    gender: "male",
    lang: "uz-UZ",
  },
  {
    id: "uz-UZ-MadinaNeural",
    name: "Madina (Standart O'zbekcha - Ayol)",
    gender: "female",
    lang: "uz-UZ",
  },
  {
    id: "en-US-AndrewMultilingualNeural",
    name: "Andrew (Multilingual - Muloyim podkast)",
    gender: "male",
    lang: "multilingual",
  },
  {
    id: "en-US-EmmaMultilingualNeural",
    name: "Emma (Multilingual - Samimiy ayol)",
    gender: "female",
    lang: "multilingual",
  },
];

const VALID_VOICE_IDS = new Set(SUPPORTED_VOICES.map((v) => v.id));

function getCacheKey(voice: string, text: string, rate = "default", pitch = "default"): string {
  return crypto.createHash("md5").update(`${voice}:${rate}:${pitch}:${text}`).digest("hex");
}

ttsRouter.get("/voices", (_req, res) => {
  return res.json(SUPPORTED_VOICES);
});

async function synthesizeText(
  text: string,
  voice = "uz-UZ-SardorNeural",
  rate = "-5%",
  pitch = "default"
): Promise<Buffer> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("Text bo'sh bo'lmasligi kerak");
  }

  const selectedVoice = VALID_VOICE_IDS.has(voice) ? voice : "uz-UZ-SardorNeural";
  const cacheKey = getCacheKey(selectedVoice, normalizedText, rate, pitch);

  const cached = ttsCache.get(cacheKey);
  if (cached) {
    return cached.buffer;
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const prosodyOptions: { rate?: string; pitch?: string } = {};
  if (rate && rate !== "default") prosodyOptions.rate = rate;
  if (pitch && pitch !== "default") prosodyOptions.pitch = pitch;

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const { audioStream } = tts.toStream(
        normalizedText,
        Object.keys(prosodyOptions).length > 0 ? (prosodyOptions as any) : undefined
      );
      const chunks: Buffer[] = [];

      audioStream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      audioStream.on("close", () => {
        const fullBuffer = Buffer.concat(chunks);
        if (ttsCache.size >= MAX_CACHE_ITEMS) {
          const oldestKey = ttsCache.keys().next().value;
          if (oldestKey) ttsCache.delete(oldestKey);
        }
        ttsCache.set(cacheKey, { buffer: fullBuffer, ts: Date.now() });
        resolve(fullBuffer);
      });

      audioStream.on("error", (err: unknown) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

ttsRouter.post("/synthesize", async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const voice = typeof req.body?.voice === "string" ? req.body.voice : "en-US-BrianMultilingualNeural";
    const rate = typeof req.body?.rate === "string" ? req.body.rate : "-5%";
    const pitch = typeof req.body?.pitch === "string" ? req.body.pitch : "default";

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text parametri kiritilishi shart" });
    }

    if (text.length > 1000) {
      return res.status(400).json({ error: "Matn juda uzun (maksimal 1000 belgi)" });
    }

    const audioBuffer = await synthesizeText(text, voice, rate, pitch);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day cache
    return res.end(audioBuffer);
  } catch (error) {
    console.error("[TTS] Synthesize error:", error);
    return res.status(500).json({ error: "Ovoz yaratishda xatolik yuz berdi" });
  }
});

ttsRouter.get("/synthesize", async (req, res) => {
  try {
    const text = typeof req.query.text === "string" ? req.query.text : "";
    const voice = typeof req.query.voice === "string" ? req.query.voice : "en-US-BrianMultilingualNeural";
    const rate = typeof req.query.rate === "string" ? (req.query.rate as string) : "-5%";
    const pitch = typeof req.query.pitch === "string" ? (req.query.pitch as string) : "default";

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text parametri kiritilishi shart" });
    }

    const audioBuffer = await synthesizeText(text, voice, rate, pitch);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.end(audioBuffer);
  } catch (error) {
    console.error("[TTS] Synthesize error:", error);
    return res.status(500).json({ error: "Ovoz yaratishda xatolik yuz berdi" });
  }
});
