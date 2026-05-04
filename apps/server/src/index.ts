import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import "express-async-errors";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import { createMessagesRouter } from "./routes/messages.js";
import { createGroupsRouter } from "./routes/groups.js";
import { authRouter } from "./routes/auth.js";
import { uploadRouter } from "./routes/upload.js";
import { usersRouter } from "./routes/users.js";
import { registerSocketHandlers } from "./socket.js";
import { sendPushUpdateAvailableToAndroid } from "./lib/push.js";

// Support multiple client origins (desktop + web + dev)
const allowedOrigins = env.CLIENT_URL.split(",").map((o) => o.trim());

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (_origin, cb) => cb(null, true),
    credentials: true
  }
});

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

app.use(
  cors({
    origin: (_origin, cb) => cb(null, true),
    credentials: true
  })
);
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(uploadDir));

// Make io accessible to routes via req.app.get("io")
app.set("io", io);

// ── AUTO-UPDATE ENDPOINTS ──
const updatesDir = path.resolve(process.cwd(), "updates");
const androidUpdatesDir = path.join(updatesDir, "android");
fs.mkdirSync(updatesDir, { recursive: true });
fs.mkdirSync(androidUpdatesDir, { recursive: true });

app.get("/update/check", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const versionFile = path.join(updatesDir, "version.json");
  if (!fs.existsSync(versionFile)) {
    return res.json({ update: false });
  }
  try {
    const info = JSON.parse(fs.readFileSync(versionFile, "utf-8")) as { version?: string; notes?: string };
    const version = typeof info.version === "string" ? info.version.trim() : "";
    if (!version) {
      return res.json({ update: false });
    }
    return res.json({ update: true, version, notes: info.notes || "" });
  } catch {
    return res.json({ update: false });
  }
});

app.get("/update/download", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const exePath = path.join(updatesDir, "ChatDesktop.exe");
  if (!fs.existsSync(exePath)) {
    return res.status(404).json({ error: "Update file not found" });
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=ChatDesktop.exe");
  res.sendFile(exePath);
});

app.get("/update/android/check", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const versionFile = path.join(androidUpdatesDir, "version.json");
  if (!fs.existsSync(versionFile)) {
    return res.json({ update: false });
  }
  try {
    const info = JSON.parse(fs.readFileSync(versionFile, "utf-8"));
    return res.json({ update: true, version: info.version, notes: info.notes || "" });
  } catch {
    return res.json({ update: false });
  }
});

app.get("/update/android/download", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const apkPath = path.join(androidUpdatesDir, "ChatMobile.apk");
  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({ error: "Update file not found" });
  }

  let downloadName = "ChatMobile.apk";
  const versionFile = path.join(androidUpdatesDir, "version.json");
  if (fs.existsSync(versionFile)) {
    try {
      const info = JSON.parse(fs.readFileSync(versionFile, "utf-8")) as { version?: string };
      if (info.version) {
        const safeVersion = info.version.replace(/[^0-9A-Za-z._-]/g, "_");
        downloadName = `ChatMobile-${safeVersion}.apk`;
      }
    } catch {
      // keep default filename if metadata is invalid
    }
  }

  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", `attachment; filename=${downloadName}`);
  res.sendFile(apkPath);
});

app.post("/update/android/notify", async (req, res) => {
  const requiredToken = env.UPDATE_NOTIFY_TOKEN;
  const providedToken = req.get("x-update-notify-token") || req.query.token;
  if (requiredToken && providedToken !== requiredToken) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const versionFile = path.join(androidUpdatesDir, "version.json");
  let version = typeof req.body?.version === "string" ? req.body.version : "";
  let notes = typeof req.body?.notes === "string" ? req.body.notes : "";

  if ((!version || !notes) && fs.existsSync(versionFile)) {
    try {
      const info = JSON.parse(fs.readFileSync(versionFile, "utf-8")) as { version?: string; notes?: string };
      if (!version) version = info.version ?? "";
      if (!notes) notes = info.notes ?? "";
    } catch {
      // ignore invalid version file and use body values if any
    }
  }

  if (!version) {
    return res.status(400).json({ message: "version is required" });
  }

  const result = await sendPushUpdateAvailableToAndroid({ version, notes });
  return res.json({ ok: true, version, ...result });
});

// ── LINK PREVIEW (OG META) ENDPOINT ──
const ogCache = new Map<string, { data: unknown; ts: number }>();
const OG_CACHE_TTL = 1000 * 60 * 60; // 1 hour

app.get("/og-meta", async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: "url query param required" });

  // Check cache
  const cached = ogCache.get(url);
  if (cached && Date.now() - cached.ts < OG_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // ── YouTube oEmbed (YouTube blocks normal OG scraping) ──
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]+)/);
    if (ytMatch) {
      const videoId = ytMatch[1];
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const oRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
      if (oRes.ok) {
        const oe = await oRes.json() as { title?: string; author_name?: string; thumbnail_url?: string };
        const data = {
          url,
          title: oe.title || null,
          description: oe.author_name ? `by ${oe.author_name}` : null,
          image: oe.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          siteName: "YouTube",
          type: "video",
          video: null,
        };
        ogCache.set(url, { data, ts: Date.now() });
        return res.json(data);
      }
    }

    // ── Spotify oEmbed ──
    if (/open\.spotify\.com/i.test(url)) {
      try {
        const oRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5000) });
        if (oRes.ok) {
          const oe = await oRes.json() as { title?: string; description?: string; thumbnail_url?: string; provider_name?: string };
          const data = {
            url,
            title: oe.title || null,
            description: oe.description || null,
            image: oe.thumbnail_url || null,
            siteName: oe.provider_name || "Spotify",
            type: "music",
            video: null,
          };
          ogCache.set(url, { data, ts: Date.now() });
          return res.json(data);
        }
      } catch {}
    }

    // ── Generic OG scraping ──
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ChatBot/1.0)",
        Accept: "text/html",
      },
    });
    clearTimeout(timeout);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.json({ url, title: null, description: null, image: null, siteName: null });
    }

    // Only read first 50KB to find OG tags
    const reader = response.body?.getReader();
    if (!reader) return res.json({ url, title: null, description: null, image: null, siteName: null });

    let html = "";
    const decoder = new TextDecoder();
    let done = false;
    while (!done && html.length < 50000) {
      const chunk = await reader.read();
      done = chunk.done;
      if (chunk.value) html += decoder.decode(chunk.value, { stream: true });
    }
    reader.cancel().catch(() => {});

    const getMetaContent = (property: string): string | null => {
      // Match og:property or name="property"
      const patterns = [
        new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"),
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i"),
        new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, "i"),
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, "i"),
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1]) return m[1];
      }
      return null;
    };

    // Extract title from <title> tag as fallback
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || null;

    const data = {
      url,
      title: getMetaContent("og:title") || getMetaContent("twitter:title") || titleTag,
      description: getMetaContent("og:description") || getMetaContent("twitter:description") || getMetaContent("description"),
      image: getMetaContent("og:image") || getMetaContent("twitter:image"),
      siteName: getMetaContent("og:site_name"),
      type: getMetaContent("og:type"),
      video: getMetaContent("og:video:url") || getMetaContent("og:video"),
    };

    // Make relative image URLs absolute
    if (data.image && !data.image.startsWith("http")) {
      try {
        data.image = new URL(data.image, url).href;
      } catch {}
    }

    ogCache.set(url, { data, ts: Date.now() });
    return res.json(data);
  } catch (err) {
    return res.json({ url, title: null, description: null, image: null, siteName: null });
  }
});

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/messages", createMessagesRouter(io));
app.use("/groups", createGroupsRouter(io));
app.use("/upload", uploadRouter);

// Serve web client build (if exists)
const webDistDir = path.resolve(process.cwd(), "web", "dist");
if (fs.existsSync(webDistDir)) {
  // Never cache sw.js and index.html
  app.get("/sw.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.join(webDistDir, "sw.js"));
  });
  // Cache hashed assets for 1 year
  app.use("/assets", express.static(path.join(webDistDir, "assets"), {
    maxAge: "1y",
    immutable: true,
  }));
  app.use(express.static(webDistDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));
  app.get("*", (_req, res, next) => {
    // Only serve index.html for non-API routes
    if (_req.path.startsWith("/auth") || _req.path.startsWith("/users") ||
        _req.path.startsWith("/messages") || _req.path.startsWith("/upload") ||
        _req.path.startsWith("/uploads") || _req.path.startsWith("/socket.io") ||
        _req.path.startsWith("/health") || _req.path.startsWith("/update") ||
        _req.path.startsWith("/og-meta")) {
      return next();
    }
    res.sendFile(path.join(webDistDir, "index.html"));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  return res.status(500).json({ message: "Server xatosi." });
});

registerSocketHandlers(io);

server.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  if (fs.existsSync(webDistDir)) {
    console.log(`Web client served at http://localhost:${env.PORT}`);
  }
});
